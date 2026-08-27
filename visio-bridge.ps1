param(
  [Parameter(Mandatory = $true)]
  [string]$PlanBase64
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
trap {
  $lineNumber = $_.InvocationInfo.ScriptLineNumber
  $sourceLine = $_.InvocationInfo.Line
  [Console]::Error.WriteLine("Visio bridge PowerShell error line ${lineNumber}: ${sourceLine}")
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

function Get-PlanString([object]$Value) {
  if ($null -eq $Value) { return "" }
  return [string]$Value
}

function Get-RgbFormula([string]$Hex) {
  $value = (Get-PlanString $Hex).TrimStart("#")
  if ($value.Length -ne 6) { return "RGB(168,85,247)" }
  $r = [Convert]::ToInt32($value.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($value.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($value.Substring(4, 2), 16)
  return "RGB($r,$g,$b)"
}

function Set-ShapeData([object]$Shape, [string]$Key, [object]$Value) {
  $cellName = "Prop.$Key"
  if ([int]$Shape.CellExistsU($cellName, 0) -eq 0) {
    $Shape.AddNamedRow(243, $Key, 0) | Out-Null
  }
  $cell = $Shape.CellsU($cellName)
  if ($Value -is [bool]) {
    $cell.FormulaU = if ($Value) { "TRUE" } else { "FALSE" }
    return
  }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
    $cell.FormulaU = ([string]$Value).Replace(",", ".")
    return
  }
  $text = (Get-PlanString $Value).Replace('"', '""')
  $cell.FormulaU = '="' + $text + '"'
}

function Set-PlanData([object]$Shape, [object]$Data) {
  if ($null -eq $Data) { return }
  foreach ($property in $Data.PSObject.Properties) {
    Set-ShapeData $Shape $property.Name $property.Value
  }
}

function Set-ShapeStyle([object]$Shape, [object]$Spec, [double]$Scale) {
  $Shape.Text = (Get-PlanString $Spec.label) + "`n" + (Get-PlanString $Spec.subtitle)
  $Shape.CellsU("FillForegnd").FormulaU = Get-RgbFormula (Get-PlanString $Spec.fill)
  $Shape.CellsU("FillBkgnd").FormulaU = Get-RgbFormula (Get-PlanString $Spec.fill)
  $Shape.CellsU("LineColor").FormulaU = Get-RgbFormula (Get-PlanString $Spec.line)
  $Shape.CellsU("LineWeight").FormulaU = "0.018 in"
  if ((Get-PlanString $Spec.shapeKind) -match "volume|tensor") {
    $Shape.CellsU("FillPattern").FormulaU = "1"
  }
  Set-PlanData $Shape $Spec.shapeData
}

function Remove-OwnedShapes([object]$Page, [string]$RenderId) {
  for ($index = $Page.Shapes.Count; $index -ge 1; $index--) {
    $shape = $Page.Shapes.Item($index)
    try {
      if ([int]$shape.CellExistsU("Prop.renderId", 0) -ne 0) {
        $existing = $shape.CellsU("Prop.renderId").ResultStr("")
        if ($existing -eq $RenderId) { $shape.Delete() }
      }
    } catch {
      # A foreign or protected shape is outside the agent-owned scope.
    }
  }
}

function Draw-PlanShape([object]$Page, [object]$Spec, [double]$Scale) {
  $x = [double]([double]$Spec.x * [double]$Scale)
  $y = [double]([double]$Spec.y * [double]$Scale)
  $w = [double]([double]$Spec.w * [double]$Scale)
  $h = [double]([double]$Spec.h * [double]$Scale)
  $kind = Get-PlanString $Spec.shapeKind
  if ($kind -match "volume|tensor") {
    $depth = [Math]::Max(0.06, [Math]::Min(0.22, $w * 0.16))
    $front = $Page.DrawRectangle($x, $y, $x + $w, $y + $h)
    Set-ShapeStyle $front $Spec $Scale

    $topPoints = [double[]]@(
      [double]$x, ([double]$y + [double]$h),
      ([double]$x + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w), ([double]$y + [double]$h)
    )
    $top = $Page.DrawPolyline($topPoints, 0)
    $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "volume-top"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $top $topSpec $Scale

    $sidePoints = [double[]]@(
      ([double]$x + [double]$w), [double]$y,
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$depth),
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w), ([double]$y + [double]$h)
    )
    $side = $Page.DrawPolyline($sidePoints, 0)
    $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "volume-side"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $side $sideSpec $Scale
    return @($front, $top, $side)
  }
  if ($kind -eq "operator-symbol") {
    $shape = $Page.DrawOval($x, $y, $x + $w, $y + $h)
    Set-ShapeStyle $shape $Spec $Scale
    return $shape
  }
  $shape = $Page.DrawRectangle($x, $y, $x + $w, $y + $h)
  Set-ShapeStyle $shape $Spec $Scale
  return $shape
}

function Draw-PlanConnector([object]$Page, [object]$Spec, [double]$Scale) {
  $points = @($Spec.points)
  if ($points.Count -lt 2) { return $null }
  $created = New-Object 'System.Collections.Generic.List[object]'
  for ($index = 0; $index -lt $points.Count - 1; $index++) {
    $from = $points[$index]
    $to = $points[$index + 1]
    $line = $Page.DrawLine(
      ([double]$from.x * $Scale),
      ([double]$from.y * $Scale),
      ([double]$to.x * $Scale),
      ([double]$to.y * $Scale)
    )
    $line.CellsU("LineColor").FormulaU = if ($Spec.type -match "skip|residual") { "RGB(0,160,128)" } else { "RGB(40,70,216)" }
    $line.CellsU("LineWeight").FormulaU = "0.014 in"
    if ($index -eq $points.Count - 2) { $line.CellsU("EndArrow").FormulaU = "13" }
    Set-PlanData $line ([pscustomobject]@{
      renderId = $Spec.renderId
      edgeId = $Spec.id
      sourceNodeId = $Spec.sourceNodeId
      targetNodeId = $Spec.targetNodeId
      visualRole = "connector"
      edgeType = $Spec.type
      evidenceCount = $Spec.evidenceCount
      planVersion = "visio-native-bridge/v1"
    })
    $created.Add($line) | Out-Null
  }
  return $created.ToArray()
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PlanBase64))
$plan = $json | ConvertFrom-Json
if ($plan.createDocument -ne $false) { throw "The Visio bridge only accepts existing documents." }
if ([string]::IsNullOrWhiteSpace([string]$plan.documentPath)) { throw "documentPath is required." }

try {
  $doc = [Runtime.InteropServices.Marshal]::BindToMoniker([string]$plan.documentPath)
} catch {
  $visio = New-Object -ComObject Visio.Application
  $doc = $visio.Documents.Open([string]$plan.documentPath)
}
$doc.Application.Visible = $true
try { $page = $doc.Pages.ItemU([string]$plan.pageName) } catch { throw "Visio page not found: $($plan.pageName)" }
Remove-OwnedShapes $page ([string]$plan.renderId)

[int]$shapeCount = 0
[int]$connectorCount = 0
foreach ($spec in @($plan.shapes)) {
  $drawn = @(Draw-PlanShape $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$drawn.Count
}
foreach ($spec in @($plan.connectors)) {
  $lines = Draw-PlanConnector $page $spec ([double]$plan.unitScale)
  if ($null -ne $lines) { $connectorCount = [int]$connectorCount + [int]@($lines).Count }
}

$doc.Save() | Out-Null
$windowActivated = $false
foreach ($window in $doc.Application.Windows) {
  try {
    if ($window.Document.FullName -eq $doc.FullName) { $window.Activate(); $windowActivated = $true; break }
  } catch {}
}

[System.Collections.Generic.List[string]]$readbackSourceNodeIds = New-Object 'System.Collections.Generic.List[string]'
[System.Collections.Generic.List[string]]$readbackEdgeIds = New-Object 'System.Collections.Generic.List[string]'
$readbackConnectorCount = 0
for ($index = 1; $index -le $page.Shapes.Count; $index++) {
  $shape = $page.Shapes.Item($index)
  try {
    if ([int]$shape.CellExistsU("Prop.renderId", 0) -eq 0) { continue }
    if ($shape.CellsU("Prop.renderId").ResultStr("") -ne [string]$plan.renderId) { continue }
    if ([int]$shape.CellExistsU("Prop.visualRole", 0) -ne 0 -and $shape.CellsU("Prop.visualRole").ResultStr("") -eq "connector") {
      $readbackConnectorCount++
      if ([int]$shape.CellExistsU("Prop.edgeId", 0) -ne 0) {
        $edgeId = $shape.CellsU("Prop.edgeId").ResultStr("")
        if ($edgeId) { $readbackEdgeIds.Add($edgeId) | Out-Null }
      }
    }
    if ([int]$shape.CellExistsU("Prop.sourceNodeId", 0) -ne 0) {
      $sourceNodeId = $shape.CellsU("Prop.sourceNodeId").ResultStr("")
      if ($sourceNodeId) { $readbackSourceNodeIds.Add($sourceNodeId) | Out-Null }
    }
  } catch {}
}

[pscustomobject]@{
  status = "rendered"
  documentPath = $doc.FullName
  pageName = $page.NameU
  renderId = [string]$plan.renderId
  createdShapes = $shapeCount
  createdConnectorSegments = $connectorCount
  totalShapes = $page.Shapes.Count
  saved = $true
  windowActivated = $windowActivated
  readback = [pscustomobject]@{
    renderId = [string]$plan.renderId
    sourceNodeIds = @($readbackSourceNodeIds | Sort-Object -Unique)
    edgeIds = @($readbackEdgeIds | Sort-Object -Unique)
    connectorCount = $readbackConnectorCount
    shapeCount = @($readbackSourceNodeIds | Sort-Object -Unique).Count
  }
} | ConvertTo-Json -Compress
