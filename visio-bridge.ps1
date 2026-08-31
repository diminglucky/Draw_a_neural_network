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

function Get-RepeatCount([object]$Spec) {
  $count = 1
  try { $count = [int]$Spec.shapeData.repeatCount } catch { $count = 1 }
  if ($count -lt 1) { return 1 }
  return $count
}

function Set-ShapeStyle([object]$Shape, [object]$Spec, [double]$Scale) {
  $Shape.Text = (Get-PlanString $Spec.label) + "`n" + (Get-PlanString $Spec.subtitle)
  $Shape.CellsU("FillForegnd").FormulaU = Get-RgbFormula (Get-PlanString $Spec.fill)
  $Shape.CellsU("FillBkgnd").FormulaU = Get-RgbFormula (Get-PlanString $Spec.fill)
  $Shape.CellsU("LineColor").FormulaU = Get-RgbFormula (Get-PlanString $Spec.line)
  $Shape.CellsU("LineWeight").FormulaU = "0.018 in"
  $Shape.CellsU("Char.Size").FormulaU = "7 pt"
  $Shape.CellsU("Para.HorzAlign").FormulaU = "1"
  $Shape.CellsU("VerticalAlign").FormulaU = "1"
  if ((Get-PlanString $Spec.shapeKind) -match "volume|tensor") {
    $Shape.CellsU("FillPattern").FormulaU = "1"
  }
  Set-PlanData $Shape $Spec.shapeData
}

function Set-PageLayout([object]$Page, [object]$Plan, [double]$Scale) {
  $artboard = $Plan.artboard
  $widthUnits = 2260
  $heightUnits = 1060
  try { $widthUnits = [double]$artboard.x + [double]$artboard.width } catch {}
  try { $heightUnits = [double]$artboard.y + [double]$artboard.height } catch {}
  $pageWidth = [Math]::Max(11.0, ($widthUnits * $Scale) + 1.2)
  $pageHeight = [Math]::Max(5.5, ($heightUnits * $Scale) + 1.0)
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $Page.PageSheet.CellsU("PageWidth").FormulaU = ($pageWidth.ToString("0.###", $culture) + " in")
  $Page.PageSheet.CellsU("PageHeight").FormulaU = ($pageHeight.ToString("0.###", $culture) + " in")
  return [pscustomobject]@{ width = $pageWidth; height = $pageHeight }
}

function Draw-FigureHeader([object]$Page, [object]$Plan, [double]$PageWidth, [double]$PageHeight, [double]$Scale) {
  $title = Get-PlanString $Plan.figure.title
  $subtitle = Get-PlanString $Plan.figure.subtitle
  if (-not [string]::IsNullOrWhiteSpace($title)) {
    $titleShape = $Page.DrawRectangle(0.6, $PageHeight - 0.55, $PageWidth - 0.6, $PageHeight - 0.15)
    $titleShape.Text = $title
    $titleShape.CellsU("FillPattern").FormulaU = "0"
    $titleShape.CellsU("LinePattern").FormulaU = "0"
    $titleShape.CellsU("Char.Size").FormulaU = "14 pt"
    $titleShape.CellsU("Char.Style").FormulaU = "1"
    $titleShape.CellsU("Para.HorzAlign").FormulaU = "1"
    Set-ShapeData $titleShape "renderId" $Plan.renderId
    Set-ShapeData $titleShape "visualRole" "figure-title"
  }
  if (-not [string]::IsNullOrWhiteSpace($subtitle)) {
    $subtitleShape = $Page.DrawRectangle(0.8, $PageHeight - 0.85, $PageWidth - 0.8, $PageHeight - 0.58)
    $subtitleShape.Text = $subtitle
    $subtitleShape.CellsU("FillPattern").FormulaU = "0"
    $subtitleShape.CellsU("LinePattern").FormulaU = "0"
    $subtitleShape.CellsU("Char.Size").FormulaU = "7 pt"
    $subtitleShape.CellsU("Para.HorzAlign").FormulaU = "1"
    Set-ShapeData $subtitleShape "renderId" $Plan.renderId
    Set-ShapeData $subtitleShape "visualRole" "figure-subtitle"
  }
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

function Remove-LegacyShapesByPrefix([object]$Page, [string]$Prefix) {
  $prefixValue = (Get-PlanString $Prefix).Trim()
  [int]$matched = 0
  [int]$removed = 0
  [int]$failed = 0
  if ([string]::IsNullOrWhiteSpace($prefixValue)) { return [pscustomobject]@{ matched = 0; removed = 0; failed = 0 } }
  for ($index = $Page.Shapes.Count; $index -ge 1; $index--) {
    $shape = $Page.Shapes.Item($index)
    try {
      if ((Get-PlanString $shape.NameU) -like "$prefixValue*") {
        $matched++
        try { $shape.Delete(); $removed++ } catch { $failed++ }
      }
    } catch {
      $failed++
    }
  }
  return [pscustomobject]@{ matched = $matched; removed = $removed; failed = $failed }
}

function Draw-PrismFaces([object]$Page, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Depth, [object]$Spec, [double]$Scale, [string]$FaceKind = "volume") {
  $front = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $front $Spec $Scale
  $topPoints = [double[]]@(
    [double]$X, ([double]$Y + [double]$H),
    ([double]$X + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W), ([double]$Y + [double]$H)
  )
  $top = $Page.DrawPolyline($topPoints, 0)
  $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "$FaceKind-top"; shapeData = $Spec.shapeData }
  Set-ShapeStyle $top $topSpec $Scale
  $sidePoints = [double[]]@(
    ([double]$X + [double]$W), [double]$Y,
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$Depth),
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W), ([double]$Y + [double]$H)
  )
  $side = $Page.DrawPolyline($sidePoints, 0)
  $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "$FaceKind-side"; shapeData = $Spec.shapeData }
  Set-ShapeStyle $side $sideSpec $Scale
  return @($front, $top, $side)
}

function Draw-ClassifierPrism([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $depth = [Math]::Max(0.05, [Math]::Min(0.12, $W * 0.18))
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($face in @(Draw-PrismFaces $Page $X $Y $W $H $depth $Spec $Scale "classifier")) { $created.Add($face) | Out-Null }
  $dotCount = 6
  $dotSize = [Math]::Max(0.035, [Math]::Min(0.09, $W * 0.16))
  $usableHeight = [Math]::Max($dotSize, $H - $dotSize * 2)
  for ($index = 0; $index -lt $dotCount; $index += 1) {
    $centerY = $Y + $dotSize + ($usableHeight * $index / ($dotCount - 1))
    $dot = $Page.DrawOval($X + (($W - $dotSize) / 2), $centerY - ($dotSize / 2), $X + (($W + $dotSize) / 2), $centerY + ($dotSize / 2))
    $dotSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.line; line = $Spec.line; shapeKind = "classifier-neuron"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $dot $dotSpec $Scale
    $created.Add($dot) | Out-Null
  }
  return $created.ToArray()
}

function Draw-SoftmaxPrism([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $depth = [Math]::Max(0.04, [Math]::Min(0.1, $W * 0.14))
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($face in @(Draw-PrismFaces $Page $X $Y $W $H $depth $Spec $Scale "softmax")) { $created.Add($face) | Out-Null }
  $barCount = 5
  for ($index = 0; $index -lt $barCount; $index += 1) {
    $barH = [Math]::Max(0.025, $H * 0.06)
    $barY = $Y + $H * (0.2 + $index * 0.14)
    $barW = $W * (0.34 + $index * 0.11)
    $bar = $Page.DrawRectangle($X + $W * 0.14, $barY, $X + $W * 0.14 + $barW, $barY + $barH)
    $barSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.line; line = $Spec.line; shapeKind = "softmax-bar"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $bar $barSpec $Scale
    $created.Add($bar) | Out-Null
  }
  return $created.ToArray()
}

function Draw-FlattenRibbon([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $front = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $front $Spec $Scale
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($front) | Out-Null
  $barCount = 7
  for ($index = 0; $index -lt $barCount; $index += 1) {
    $barW = [Math]::Max(0.025, $W * 0.045)
    $barH = $H * (0.3 + (($index % 3) * 0.12))
    $barX = $X + $W * (0.16 + $index * 0.1)
    $barY = $Y + (($H - $barH) / 2)
    $bar = $Page.DrawRectangle($barX, $barY, $barX + $barW, $barY + $barH)
    $barSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.line; line = $Spec.line; shapeKind = "flatten-bar"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $bar $barSpec $Scale
    $created.Add($bar) | Out-Null
  }
  return $created.ToArray()
}

function Draw-PlanShape([object]$Page, [object]$Spec, [double]$Scale) {
  $x = [double]([double]$Spec.x * [double]$Scale)
  $y = [double]([double]$Spec.y * [double]$Scale)
  $w = [double]([double]$Spec.w * [double]$Scale)
  $h = [double]([double]$Spec.h * [double]$Scale)
  $kind = Get-PlanString $Spec.shapeKind
  if ($kind -eq "classifier-prism") { return @(Draw-ClassifierPrism $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "softmax-prism") { return @(Draw-SoftmaxPrism $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "flatten-ribbon") { return @(Draw-FlattenRibbon $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "pool-prism") {
    $depth = [Math]::Max(0.05, [Math]::Min(0.16, $w * 0.22))
    $front = $Page.DrawRectangle($x, $y, $x + $w, $y + $h)
    Set-ShapeStyle $front $Spec $Scale
    $topPoints = [double[]]@(
      [double]$x, ([double]$y + [double]$h),
      ([double]$x + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w), ([double]$y + [double]$h)
    )
    $top = $Page.DrawPolyline($topPoints, 0)
    $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "pool-top"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $top $topSpec $Scale
    $sidePoints = [double[]]@(
      ([double]$x + [double]$w), [double]$y,
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$depth),
      ([double]$x + [double]$w + [double]$depth), ([double]$y + [double]$h + [double]$depth),
      ([double]$x + [double]$w), ([double]$y + [double]$h)
    )
    $side = $Page.DrawPolyline($sidePoints, 0)
    $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "pool-side"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $side $sideSpec $Scale
    return @($front, $top, $side)
  }
  if ($kind -match "volume|tensor") {
    $depth = [Math]::Max(0.06, [Math]::Min(0.22, $w * 0.16))
    $repeat = Get-RepeatCount $Spec
    $visible = [Math]::Min(4, $repeat)
    $offset = [Math]::Min(0.12, [Math]::Max(0.025, $depth * 0.7))
    $created = New-Object 'System.Collections.Generic.List[object]'
    for ($layer = $visible - 1; $layer -ge 0; $layer--) {
      $layerX = [double]$x - ([double]$layer * $offset)
      $layerY = [double]$y + ([double]$layer * $offset * 0.35)
      $layerSpec = $Spec
      if ($layer -ne 0) {
        $layerSpec = [pscustomobject]@{
          label = ""
          subtitle = ""
          fill = $Spec.fill
          line = $Spec.line
          shapeKind = $Spec.shapeKind
          shapeData = $Spec.shapeData
        }
      }
      $front = $Page.DrawRectangle($layerX, $layerY, $layerX + $w, $layerY + $h)
      Set-ShapeStyle $front $layerSpec $Scale
      $created.Add($front) | Out-Null

      $topPoints = [double[]]@(
        [double]$layerX, ([double]$layerY + [double]$h),
        ([double]$layerX + [double]$depth), ([double]$layerY + [double]$h + [double]$depth),
        ([double]$layerX + [double]$w + [double]$depth), ([double]$layerY + [double]$h + [double]$depth),
        ([double]$layerX + [double]$w), ([double]$layerY + [double]$h)
      )
      $top = $Page.DrawPolyline($topPoints, 0)
      $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "volume-top"; shapeData = $Spec.shapeData }
      Set-ShapeStyle $top $topSpec $Scale
      $created.Add($top) | Out-Null

      $sidePoints = [double[]]@(
        ([double]$layerX + [double]$w), [double]$layerY,
        ([double]$layerX + [double]$w + [double]$depth), ([double]$layerY + [double]$depth),
        ([double]$layerX + [double]$w + [double]$depth), ([double]$layerY + [double]$h + [double]$depth),
        ([double]$layerX + [double]$w), ([double]$layerY + [double]$h)
      )
      $side = $Page.DrawPolyline($sidePoints, 0)
      $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "volume-side"; shapeData = $Spec.shapeData }
      Set-ShapeStyle $side $sideSpec $Scale
      $created.Add($side) | Out-Null
    }
    return $created.ToArray()
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

function Glue-Endpoint([object]$Line, [string]$CellName, [object]$Target, [bool]$AtRight) {
  if ($null -eq $Target) { return }
  try {
    $position = if ($AtRight) { 1.0 } else { 0.0 }
    $Line.CellsU($CellName).GlueToPos($Target, $position, 0.5)
  } catch {
    try { $Line.CellsU($CellName).GlueTo($Target.CellsU("PinX")) } catch {}
  }
}

function Draw-PlanConnector([object]$Page, [object]$Spec, [double]$Scale, [hashtable]$ShapeMap) {
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
    $segmentRole = if ($points.Count -eq 2) { "direct" } elseif ($index -eq 0) { "begin" } elseif ($index -eq $points.Count - 2) { "end" } else { "middle" }
    if ($index -eq 0) { Glue-Endpoint $line "BeginX" $ShapeMap[[string]$Spec.sourceShapeId] $true }
    if ($index -eq $points.Count - 2) { Glue-Endpoint $line "EndX" $ShapeMap[[string]$Spec.targetShapeId] $false }
    Set-PlanData $line ([pscustomobject]@{
      renderId = $Spec.renderId
      edgeId = $Spec.id
      sourceNodeId = $Spec.sourceNodeId
      targetNodeId = $Spec.targetNodeId
      visualRole = "connector"
      edgeType = $Spec.type
      sourceShapeId = $Spec.sourceShapeId
      targetShapeId = $Spec.targetShapeId
      segmentRole = $segmentRole
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

$visio = $null
if ([string]$plan.openMode -eq "fresh") {
  $visio = New-Object -ComObject Visio.Application
  $doc = $visio.Documents.Open([string]$plan.documentPath)
} else {
  try {
    $doc = [Runtime.InteropServices.Marshal]::BindToMoniker([string]$plan.documentPath)
  } catch {
    $visio = New-Object -ComObject Visio.Application
    $doc = $visio.Documents.Open([string]$plan.documentPath)
  }
}
$doc.Application.Visible = $true
try { $page = $doc.Pages.ItemU([string]$plan.pageName) } catch { throw "Visio page not found: $($plan.pageName)" }
Remove-OwnedShapes $page ([string]$plan.renderId)
$legacyCleanup = [pscustomobject]@{ matched = 0; removed = 0; failed = 0 }
if (-not [string]::IsNullOrWhiteSpace([string]$plan.replaceLegacyPrefix)) {
  $legacyCleanup = Remove-LegacyShapesByPrefix $page ([string]$plan.replaceLegacyPrefix)
}
$pageSize = Set-PageLayout $page $plan ([double]$plan.unitScale)
Draw-FigureHeader $page $plan ([double]$pageSize.width) ([double]$pageSize.height) ([double]$plan.unitScale)

[int]$shapeCount = 0
[int]$connectorCount = 0
$shapeMap = @{}
foreach ($spec in @($plan.shapes)) {
  $drawn = @(Draw-PlanShape $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$drawn.Count
  if ($drawn.Count -gt 0) { $shapeMap[$spec.id] = $drawn[0] }
}
foreach ($spec in @($plan.connectors)) {
  $lines = Draw-PlanConnector $page $spec ([double]$plan.unitScale) $shapeMap
  if ($null -ne $lines) { $connectorCount = [int]$connectorCount + [int]@($lines).Count }
}

$doc.Save() | Out-Null
$windowActivated = $false
foreach ($window in $doc.Application.Windows) {
  try {
    if ($window.Document.FullName -eq $doc.FullName) {
      $window.Activate() | Out-Null
      try { $window.ViewFit() | Out-Null } catch {}
      $windowActivated = $true
      break
    }
  } catch {}
}

[System.Collections.Generic.List[string]]$readbackSourceNodeIds = New-Object 'System.Collections.Generic.List[string]'
[System.Collections.Generic.List[string]]$readbackEdgeIds = New-Object 'System.Collections.Generic.List[string]'
[System.Collections.Generic.List[string]]$gluedBeginEdgeIds = New-Object 'System.Collections.Generic.List[string]'
[System.Collections.Generic.List[string]]$gluedEndEdgeIds = New-Object 'System.Collections.Generic.List[string]'
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
        if ($edgeId) {
          $readbackEdgeIds.Add($edgeId) | Out-Null
          $segmentRole = ""
          try { if ([int]$shape.CellExistsU("Prop.segmentRole", 0) -ne 0) { $segmentRole = $shape.CellsU("Prop.segmentRole").ResultStr("") } } catch {}
          $connectCount = 0
          try { $connectCount = [int]$shape.Connects.Count } catch {}
          if ($connectCount -gt 0 -and ($segmentRole -eq "begin" -or $segmentRole -eq "direct")) { $gluedBeginEdgeIds.Add($edgeId) | Out-Null }
          if ($connectCount -gt 0 -and ($segmentRole -eq "end" -or $segmentRole -eq "direct")) { $gluedEndEdgeIds.Add($edgeId) | Out-Null }
        }
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
  legacyCleanup = $legacyCleanup
  windowActivated = $windowActivated
  readback = [pscustomobject]@{
    renderId = [string]$plan.renderId
    sourceNodeIds = @($readbackSourceNodeIds | Sort-Object -Unique)
    edgeIds = @($readbackEdgeIds | Sort-Object -Unique)
    gluedBeginEdgeIds = @($gluedBeginEdgeIds | Sort-Object -Unique)
    gluedEndEdgeIds = @($gluedEndEdgeIds | Sort-Object -Unique)
    connectorCount = $readbackConnectorCount
    shapeCount = @($readbackSourceNodeIds | Sort-Object -Unique).Count
  }
} | ConvertTo-Json -Compress
