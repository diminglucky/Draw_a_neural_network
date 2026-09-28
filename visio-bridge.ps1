param(
  [string]$PlanBase64 = "",
  [switch]$WorkerMode
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($PlanBase64 -eq "__STDIN__") {
  $PlanBase64 = [Console]::In.ReadToEnd()
}
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

function Get-SemanticColor([object]$Spec, [string]$FaceRole = "front") {
  $profile = (Get-PlanString $Spec.styleProfile).ToLowerInvariant()
  $role = (Get-PlanString $Spec.visualRole).ToLowerInvariant()
  $semanticRole = ""
  try { $semanticRole = (Get-PlanString $Spec.shapeData.semanticRole).ToLowerInvariant() } catch {}
  $fallback = Get-PlanString $Spec.fill
  $styleKey = if (-not [string]::IsNullOrWhiteSpace($profile)) { $profile } elseif (-not [string]::IsNullOrWhiteSpace($role)) { $role } else { $semanticRole }
  $base = switch ($styleKey) {
    "feature-map" { "#FFC47A"; break }
    "feature-map-band" { "#E65034"; break }
    "input-tensor" { "#FFE6A6"; break }
    "image-input" { "#DCEAF4"; break }
    "sequence-input" { "#E2EEF8"; break }
    "state-input" { "#E8DDF5"; break }
    "vector-input" { "#E2F3E7"; break }
    "volume-input" { "#D9EEF0"; break }
    "unknown-input" { "#F5F0E7"; break }
    "pool" { "#E65034"; break }
    "upsample" { "#5FBF7F"; break }
    "vectorize" { "#7A238C"; break }
    "neuron" { "#9563C8"; break }
    "output" { "#7A238C"; break }
    "merge" { "#F4D7A8"; break }
    "attention" { "#E8DDF5"; break }
    "token" { "#E2EEF8"; break }
    "compound" { "#E7EEF5"; break }
    "unresolved" { "#F5F0E7"; break }
    "decision" { "#FBE8B8"; break }
    "merge-add" { "#F4D7A8"; break }
    "merge-concat" { "#E9EDF2"; break }
    "split" { "#D3EEF0"; break }
    "junction" { "#D3EEF0"; break }
    "residual" { "#D3EEF0"; break }
    "scale-transfer" { "#D8F0DE"; break }
    "prediction" { "#FAD9D2"; break }
    default { $fallback }
  }
  if ([string]::IsNullOrWhiteSpace($base)) { $base = "#E7EEF5" }
  switch ($FaceRole.ToLowerInvariant()) {
    "top" {
      if ($profile -eq "feature-map") { return "#FFE7BF" }
      if ($profile -eq "feature-map-band" -or $profile -eq "pool") { return "#F5815A" }
      if ($profile -eq "input-tensor") { return "#FFF3D0" }
      if ($profile -eq "image-input") { return "#F5FBFF" }
      if ($profile -eq "sequence-input") { return "#F6FBFF" }
      if ($profile -eq "state-input") { return "#F5EEFC" }
      if ($profile -eq "vector-input") { return "#F0FAF2" }
      if ($profile -eq "volume-input") { return "#EFFBFC" }
      if ($profile -eq "unknown-input") { return "#FBF8F0" }
      if ($profile -eq "neuron") { return "#B88AE0" }
      if ($profile -eq "vectorize" -or $profile -eq "output") { return "#A854B9" }
      return $base
    }
    "side" {
      if ($profile -eq "feature-map") { return "#BC5F32" }
      if ($profile -eq "feature-map-band" -or $profile -eq "pool") { return "#9E271A" }
      if ($profile -eq "input-tensor") { return "#D89D43" }
      if ($profile -eq "image-input") { return "#6E91AA" }
      if ($profile -eq "sequence-input") { return "#6E91AA" }
      if ($profile -eq "state-input") { return "#815AA0" }
      if ($profile -eq "vector-input") { return "#5C9A69" }
      if ($profile -eq "volume-input") { return "#43878C" }
      if ($profile -eq "unknown-input") { return "#9D8A65" }
      if ($profile -eq "neuron") { return "#70459B" }
      if ($profile -eq "vectorize" -or $profile -eq "output") { return "#4C0F5A" }
      return $base
    }
    default { return $base }
  }
}

function Get-SemanticLineColor([object]$Spec) {
  $line = Get-PlanString $Spec.line
  if (-not [string]::IsNullOrWhiteSpace($line) -and $line -ne "#263248") { return $line }
  $profile = (Get-PlanString $Spec.styleProfile).ToLowerInvariant()
  $role = (Get-PlanString $Spec.visualRole).ToLowerInvariant()
  $semanticRole = ""
  try { $semanticRole = (Get-PlanString $Spec.shapeData.semanticRole).ToLowerInvariant() } catch {}
  $styleKey = if (-not [string]::IsNullOrWhiteSpace($profile)) { $profile } elseif (-not [string]::IsNullOrWhiteSpace($role)) { $role } else { $semanticRole }
  $lineColor = switch ($styleKey) {
    "decision" { "#C08A1E" }
    "merge" { "#8B6A32" }
    "merge-add" { "#8B6A32" }
    "merge-concat" { "#7A8696" }
    "split" { "#2E7F8C" }
    "junction" { "#2E7F8C" }
    "residual" { "#2E7F8C" }
    "scale-transfer" { "#3E8E5A" }
    "prediction" { "#C0432E" }
    default { "#3F5D78" }
  }
  return $lineColor
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
    if ($property.Name -eq "sourceNodeIds") {
      $sourceNodeIdsJson = ConvertTo-Json -Compress -InputObject @($property.Value)
      Set-ShapeData $Shape $property.Name $sourceNodeIdsJson
    } else {
      Set-ShapeData $Shape $property.Name $property.Value
    }
  }
}

function Set-NativeShapeIdentity([object]$Shape, [object]$PlanId) {
  $planShapeId = Get-PlanString $PlanId
  if ([string]::IsNullOrWhiteSpace($planShapeId)) { return }
  Set-ShapeData $Shape "planShapeId" $planShapeId
  $nativeId = "Agent_" + ($planShapeId -replace '[^A-Za-z0-9_]', '_')
  try { $Shape.NameU = $nativeId } catch {}
}

function Get-NativeShapeForPlan([object[]]$Shapes, [string]$PlanId) {
  foreach ($shape in @($Shapes)) {
    try {
      if ([int]$shape.CellExistsU("Prop.planShapeId", 0) -eq 0) { continue }
      $actual = Get-PlanString $shape.CellsU("Prop.planShapeId").ResultStr("")
      if ($actual -eq $PlanId) { return $shape }
    } catch {}
  }
  if (@($Shapes).Count -gt 0) { return @($Shapes)[0] }
  return $null
}

function Get-RepeatCount([object]$Spec) {
  $count = 1
  try { $count = [int]$Spec.shapeData.repeatCount } catch { $count = 1 }
  if ($count -lt 1) { return 1 }
  return $count
}

function Set-ShapeStyle([object]$Shape, [object]$Spec, [double]$Scale) {
  $labelOutside = $false
  try { $labelOutside = [bool]$Spec.labelOutside } catch { $labelOutside = $false }
  $Shape.Text = if ($labelOutside) { "" } else { (Get-PlanString $Spec.label) + "`n" + (Get-PlanString $Spec.subtitle) }
  $faceRole = Get-PlanString $Spec.faceRole
  if ([string]::IsNullOrWhiteSpace($faceRole)) { $faceRole = "front" }
  $fill = Get-SemanticColor $Spec $faceRole
  $Shape.CellsU("FillForegnd").FormulaU = Get-RgbFormula $fill
  $Shape.CellsU("FillBkgnd").FormulaU = Get-RgbFormula $fill
  $opacityProperty = $Spec.PSObject.Properties["fillOpacity"]
  if ($null -ne $opacityProperty) {
    $fillOpacity = [double]$opacityProperty.Value
    if ($fillOpacity -ge 0 -and $fillOpacity -le 1) {
      $transparency = (100 * (1 - $fillOpacity)).ToString("0.###", [Globalization.CultureInfo]::InvariantCulture) + "%"
      $Shape.CellsU("FillForegndTrans").FormulaU = $transparency
      $Shape.CellsU("FillBkgndTrans").FormulaU = $transparency
    }
  }
  $line = Get-SemanticLineColor $Spec
  $Shape.CellsU("LineColor").FormulaU = Get-RgbFormula $line
  $Shape.CellsU("LineWeight").FormulaU = if ($faceRole -eq "front") { "0.011 in" } else { "0.008 in" }
  $Shape.CellsU("Char.Size").FormulaU = if ($labelOutside) { "8 pt" } else { "7 pt" }
  $Shape.CellsU("Para.HorzAlign").FormulaU = "1"
  $Shape.CellsU("VerticalAlign").FormulaU = "1"
  if ((Get-PlanString $Spec.shapeKind) -match "volume|tensor|feature-map") {
    $Shape.CellsU("FillPattern").FormulaU = "1"
  }
  Set-PlanData $Shape $Spec.shapeData
}

function Set-PageLayout([object]$Page, [object]$Plan, [double]$Scale) {
  $artboard = $Plan.artboard
  $maxX = 0.0
  $maxY = 0.0
  foreach ($shape in @($Plan.shapes)) {
    try { $maxX = [Math]::Max($maxX, [double]$shape.x + [double]$shape.w) } catch {}
    try { $maxY = [Math]::Max($maxY, [double]$shape.y + [double]$shape.h) } catch {}
  }
  foreach ($group in @($Plan.groups)) {
    try { $maxX = [Math]::Max($maxX, [double]$group.bounds.x + [double]$group.bounds.w) } catch {}
    try { $maxY = [Math]::Max($maxY, [double]$group.bounds.y + [double]$group.bounds.h) } catch {}
  }
  foreach ($connector in @($Plan.connectors)) {
    foreach ($point in @($connector.points)) {
      try { $maxX = [Math]::Max($maxX, [double]$point.x) } catch {}
      try { $maxY = [Math]::Max($maxY, [double]$point.y) } catch {}
    }
  }
  if ($maxX -le 0 -or $maxY -le 0) {
    try { $maxX = [double]$artboard.x + [double]$artboard.width } catch { $maxX = 2260 }
    try { $maxY = [double]$artboard.y + [double]$artboard.height } catch { $maxY = 1060 }
  }
  $pageWidth = [Math]::Max(6.0, ($maxX * $Scale) + 0.8)
  $pageHeight = [Math]::Max(4.8, ($maxY * $Scale) + 1.25)
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
    $subtitleShape = $Page.DrawRectangle(0.8, $PageHeight - 0.95, $PageWidth - 0.8, $PageHeight - 0.65)
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
  $shapes = $Page.Shapes
  if ($null -eq $shapes) { return }
  for ($index = [int]$shapes.Count; $index -ge 1; $index--) {
    $shape = $null
    try { $shape = $shapes.Item($index) } catch { continue }
    if ($null -eq $shape) { continue }
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

function Quarantine-AgentShape([object]$Shape) {
  try {
    $Shape.Text = ""
    $Shape.CellsU("FillPattern").FormulaU = "0"
    $Shape.CellsU("LinePattern").FormulaU = "0"
    $Shape.CellsU("Char.Color").FormulaU = "RGB(255,255,255)"
    return $true
  } catch {
    return $false
  }
}

function Remove-StaleAgentShapes([object]$Page) {
  [int]$matched = 0
  [int]$removed = 0
  [int]$quarantined = 0
  [int]$failed = 0
  [System.Collections.Generic.List[string]]$errors = New-Object 'System.Collections.Generic.List[string]'
  $shapes = $Page.Shapes
  if ($null -eq $shapes) {
    $errors.Add("Visio page shapes collection is unavailable.") | Out-Null
    return [pscustomobject]@{ matched = $matched; removed = $removed; quarantined = $quarantined; failed = 1; errors = @($errors) }
  }
  for ($index = [int]$shapes.Count; $index -ge 1; $index--) {
    $shape = $null
    try { $shape = $shapes.Item($index) } catch {
      $failed++
      if ($errors.Count -lt 3) { $errors.Add($_.Exception.Message) | Out-Null }
      continue
    }
    if ($null -eq $shape) { continue }
    try {
      if ([int]$shape.CellExistsU("Prop.renderId", 0) -eq 0) { continue }
      $existing = Get-PlanString $shape.CellsU("Prop.renderId").ResultStr("")
      if ($existing -notlike "agent-scope-*") { continue }
      $matched++
      try { $shape.Delete(); $removed++ } catch {
        if (Quarantine-AgentShape $shape) { $quarantined++ }
        else { $failed++; if ($errors.Count -lt 3) { $errors.Add($_.Exception.Message) | Out-Null } }
      }
    } catch {
      $failed++
      if ($errors.Count -lt 3) { $errors.Add($_.Exception.Message) | Out-Null }
    }
  }
  return [pscustomobject]@{ matched = $matched; removed = $removed; quarantined = $quarantined; failed = $failed; errors = @($errors) }
}

function Remove-LegacyShapesByPrefix([object]$Page, [string]$Prefix) {
  $prefixValue = (Get-PlanString $Prefix).Trim()
  [int]$matched = 0
  [int]$removed = 0
  [int]$failed = 0
  if ([string]::IsNullOrWhiteSpace($prefixValue)) { return [pscustomobject]@{ matched = 0; removed = 0; failed = 0 } }
  $shapes = $Page.Shapes
  if ($null -eq $shapes) { return [pscustomobject]@{ matched = 0; removed = 0; failed = 1 } }
  for ($index = [int]$shapes.Count; $index -ge 1; $index--) {
    $shape = $null
    try { $shape = $shapes.Item($index) } catch { $failed++; continue }
    if ($null -eq $shape) { continue }
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
  $frontSpec = [pscustomobject]@{
    label = $Spec.label
    subtitle = $Spec.subtitle
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = $Spec.shapeKind
    visualRole = $Spec.visualRole
    styleProfile = $Spec.styleProfile
    labelOutside = $Spec.labelOutside
    shapeData = $Spec.shapeData
    faceRole = "front"
  }
  Set-ShapeStyle $front $frontSpec $Scale
  $topPoints = [double[]]@(
    [double]$X, ([double]$Y + [double]$H),
    ([double]$X + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W), ([double]$Y + [double]$H)
  )
  $top = $Page.DrawPolyline($topPoints, 0)
  $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "$FaceKind-top"; visualRole = $Spec.visualRole; styleProfile = $Spec.styleProfile; shapeData = $Spec.shapeData; faceRole = "top" }
  Set-ShapeStyle $top $topSpec $Scale
  $sidePoints = [double[]]@(
    ([double]$X + [double]$W), [double]$Y,
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$Depth),
    ([double]$X + [double]$W + [double]$Depth), ([double]$Y + [double]$H + [double]$Depth),
    ([double]$X + [double]$W), ([double]$Y + [double]$H)
  )
  $side = $Page.DrawPolyline($sidePoints, 0)
  $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "$FaceKind-side"; visualRole = $Spec.visualRole; styleProfile = $Spec.styleProfile; shapeData = $Spec.shapeData; faceRole = "side" }
  Set-ShapeStyle $side $sideSpec $Scale
  return @($front, $top, $side)
}

function Project-PublicationTensorTensorPoint([double]$X, [double]$Y, [double]$Flow, [double]$Vertical, [double]$DepthCoordinate) {
  # Exact PGF/TikZ default basis used by PublicationTensor:
  # x=(1,0), y=(0,1), z=(-0.385,-0.385).
  return [pscustomobject]@{
    x = $X + $Flow + ($DepthCoordinate * -0.385)
    y = $Y + $Vertical + ($DepthCoordinate * -0.385)
  }
}

function New-PublicationTensorFaceSpec([object]$Spec, [string]$ShapeKind, [string]$FaceRole, [double]$FillOpacity = 0.4) {
  return [pscustomobject]@{
    label = ""
    subtitle = ""
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = $ShapeKind
    visualRole = $Spec.visualRole
    styleProfile = $Spec.styleProfile
    labelOutside = $false
    shapeData = $Spec.shapeData
    faceRole = $FaceRole
    fillOpacity = $FillOpacity
  }
}

function Draw-PublicationTensorPolygon([object]$Page, [object[]]$Points, [object]$Spec, [double]$Scale) {
  $coordinates = New-Object 'System.Collections.Generic.List[double]'
  foreach ($point in $Points) {
    $coordinates.Add([double]$point.x) | Out-Null
    $coordinates.Add([double]$point.y) | Out-Null
  }
  $coordinates.Add([double]$Points[0].x) | Out-Null
  $coordinates.Add([double]$Points[0].y) | Out-Null
  $shape = $Page.DrawPolyline($coordinates.ToArray(), 0)
  Set-ShapeStyle $shape $Spec $Scale
  return $shape
}

function Draw-PublicationTensorFarEdge([object]$Page, [object]$Start, [object]$End, [object]$Spec) {
  $edge = $Page.DrawLine([double]$Start.x, [double]$Start.y, [double]$End.x, [double]$End.y)
  $edge.CellsU("LineColor").FormulaU = Get-RgbFormula $Spec.line
  $edge.CellsU("LineWeight").FormulaU = "0.006 in"
  $edge.CellsU("LinePattern").FormulaU = "2"
  Set-PlanData $edge $Spec.shapeData
  return $edge
}

function Draw-PublicationTensorTensorBox([object]$Page, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$TensorDepth, [object]$Spec, [double]$Scale, [string]$FaceKind, [bool]$DrawEastFace = $false) {
  # This is a direct native-Visio transcription of PublicationTensor Box.sty:
  # a,b,c,d are the near tensor plane; e,f,g,h are the far tensor plane.
  # Each CNN cell receives the same geometry, rather than a copied full plane.
  $originX = $X + (0.385 * $TensorDepth / 2)
  $originY = $Y + (0.385 * $TensorDepth / 2)
  $halfDepth = $TensorDepth / 2
  $baseOpacity = 0.4
  if ($null -ne $Spec.PSObject.Properties["fillOpacity"]) {
    try { $baseOpacity = [double]$Spec.fillOpacity } catch { $baseOpacity = 0.4 }
  }
  try { if ($null -ne $Spec.fillOpacity) { $baseOpacity = [double]$Spec.fillOpacity } } catch {}
  $pointA = Project-PublicationTensorTensorPoint $originX $originY 0 $H $halfDepth
  $pointB = Project-PublicationTensorTensorPoint $originX $originY 0 0 $halfDepth
  $pointC = Project-PublicationTensorTensorPoint $originX $originY $W 0 $halfDepth
  $pointD = Project-PublicationTensorTensorPoint $originX $originY $W $H $halfDepth
  $pointE = Project-PublicationTensorTensorPoint $originX $originY $W $H (-$halfDepth)
  $pointF = Project-PublicationTensorTensorPoint $originX $originY $W 0 (-$halfDepth)
  $pointG = Project-PublicationTensorTensorPoint $originX $originY 0 0 (-$halfDepth)
  $pointH = Project-PublicationTensorTensorPoint $originX $originY 0 $H (-$halfDepth)

  $created = New-Object 'System.Collections.Generic.List[object]'
  $near = Draw-PublicationTensorPolygon $Page @($pointD, $pointA, $pointB, $pointC) (New-PublicationTensorFaceSpec $Spec "$FaceKind-near" "front" $baseOpacity) $Scale
  $created.Add($near) | Out-Null
  $top = Draw-PublicationTensorPolygon $Page @($pointD, $pointA, $pointH, $pointE) (New-PublicationTensorFaceSpec $Spec "$FaceKind-top" "top" $baseOpacity) $Scale
  $created.Add($top) | Out-Null
  foreach ($edge in @(
      (Draw-PublicationTensorFarEdge $Page $pointF $pointG (New-PublicationTensorFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity)),
      (Draw-PublicationTensorFarEdge $Page $pointB $pointG (New-PublicationTensorFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity)),
      (Draw-PublicationTensorFarEdge $Page $pointH $pointG (New-PublicationTensorFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity))
    )) {
    $created.Add($edge) | Out-Null
  }
  if ($DrawEastFace) {
    $east = Draw-PublicationTensorPolygon $Page @($pointD, $pointE, $pointF, $pointC) (New-PublicationTensorFaceSpec $Spec "$FaceKind-east" "side" $baseOpacity) $Scale
    $created.Add($east) | Out-Null
  }
  return $created.ToArray()
}

function Draw-InputTensor([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LineWeight").FormulaU = "0.012 in"
  Set-NativeShapeIdentity $shape $Spec.id
  return @($shape)
}

function Draw-RepeatBadge([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $count = Get-RepeatCount $Spec
  if ($count -le 1) { return @() }
  $badgeW = [Math]::Max(0.28, [Math]::Min(0.48, $W * 0.28))
  $badgeH = [Math]::Max(0.16, [Math]::Min(0.24, $H * 0.32))
  $badge = $Page.DrawRectangle($X + $W - $badgeW * 0.65, $Y + $H - $badgeH * 0.35, $X + $W + $badgeW * 0.35, $Y + $H + $badgeH * 0.65)
  $badge.Text = "x$count"
  $badge.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#FFFFFF"
  $badge.CellsU("LineColor").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $badge.CellsU("LineWeight").FormulaU = "0.008 in"
  $badge.CellsU("Char.Size").FormulaU = "7 pt"
  $badge.CellsU("Char.Style").FormulaU = "1"
  $badge.CellsU("Para.HorzAlign").FormulaU = "1"
  $badge.CellsU("VerticalAlign").FormulaU = "1"
  Set-PlanData $badge $Spec.shapeData
  return @($badge)
}

function Draw-FeaturePlane([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LineWeight").FormulaU = "0.012 in"
  Set-NativeShapeIdentity $shape $Spec.id
  $created.Add($shape) | Out-Null
  foreach ($badge in @(Draw-RepeatBadge $Page $Spec $X $Y $W $H $Scale)) { $created.Add($badge) | Out-Null }
  return $created.ToArray()
}

function Draw-FeatureVolume([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # CNN feature maps should read as volumetric tensors, not flat flowchart
  # cards. Keep the geometry in the PublicationTensor basis so the depth,
  # top face, and east face stay consistent with the native tensor grammar.
  $depth = [Math]::Max($W * 0.22, $H * 0.18)
  $depth = [Math]::Min($depth, [Math]::Min($W * 0.46, $H * 0.72))
  $volumeSpec = [pscustomobject]@{
    label = $Spec.label
    subtitle = $Spec.subtitle
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = $Spec.shapeKind
    visualRole = $Spec.visualRole
    styleProfile = $Spec.styleProfile
    labelOutside = $Spec.labelOutside
    shapeData = $Spec.shapeData
    faceRole = "front"
    fillOpacity = 0.72
  }
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($shape in @(Draw-PublicationTensorTensorBox $Page $X $Y $W $H $depth $volumeSpec $Scale "feature-volume" $true)) {
    $created.Add($shape) | Out-Null
  }
  foreach ($badge in @(Draw-RepeatBadge $Page $Spec $X $Y $W $H $Scale)) { $created.Add($badge) | Out-Null }
  return $created.ToArray()
}

function Draw-ImageInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LineWeight").FormulaU = "0.016 in"
  Set-NativeShapeIdentity $shape $Spec.id
  $created.Add($shape) | Out-Null
  $inset = [Math]::Max(0.035, [Math]::Min($W, $H) * 0.08)
  $viewport = $Page.DrawRectangle($X + $inset, $Y + $inset, $X + $W - $inset, $Y + $H - $inset)
  $viewport.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $viewport.CellsU("FillBkgnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $viewport.CellsU("LineColor").FormulaU = Get-RgbFormula "#9BB0BF"
  $viewport.CellsU("LineWeight").FormulaU = "0.006 in"
  $viewport.Text = ""
  Set-PlanData $viewport $Spec.shapeData
  $created.Add($viewport) | Out-Null
  $channelCount = 0
  try { $channelCount = [int]$Spec.shapeData.channelCount } catch {}
  if ($channelCount -gt 0) {
    $badgeW = [Math]::Max(0.18, [Math]::Min(0.34, $W * 0.28))
    $badgeH = [Math]::Max(0.11, [Math]::Min(0.18, $H * 0.18))
    $badge = $Page.DrawOval($X + $W - $badgeW - ($inset * 0.35), $Y + $H - $badgeH - ($inset * 0.35), $X + $W - ($inset * 0.35), $Y + $H - ($inset * 0.35))
    $badge.Text = "$channelCount ch"
    $badge.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#E8F0F5"
    $badge.CellsU("LineColor").FormulaU = Get-RgbFormula "#6E91AA"
    $badge.CellsU("LineWeight").FormulaU = "0.006 in"
    $badge.CellsU("Char.Size").FormulaU = "6 pt"
    $badge.CellsU("Para.HorzAlign").FormulaU = "1"
    $badge.CellsU("VerticalAlign").FormulaU = "1"
    Set-PlanData $badge $Spec.shapeData
    $created.Add($badge) | Out-Null
  }
  return $created.ToArray()
}

function Draw-SequenceInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $rail = $Page.DrawLine($X, $Y + $H / 2, $X + $W, $Y + $H / 2)
  $rail.CellsU("LineColor").FormulaU = Get-RgbFormula "#6E91AA"
  $rail.CellsU("LineWeight").FormulaU = "0.014 in"
  Set-PlanData $rail $Spec.shapeData
  $tokens = 5
  try { if ([int]$Spec.shapeData.repeatCount -gt 0) { $tokens = [Math]::Min(8, [int]$Spec.shapeData.repeatCount) } } catch {}
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($rail) | Out-Null
  $tokenW = [Math]::Max(0.12, $W / ($tokens * 1.45))
  for ($index = 0; $index -lt $tokens; $index += 1) {
    $tokenX = $X + ($index + 0.5) * $W / $tokens
    $token = $Page.DrawRectangle($tokenX - $tokenW / 2, $Y + $H * 0.18, $tokenX + $tokenW / 2, $Y + $H * 0.82)
    $tokenSpec = [pscustomobject]@{ label = "t$($index + 1)"; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "sequence-token"; visualRole = $Spec.visualRole; styleProfile = "sequence-input"; shapeData = $Spec.shapeData; labelOutside = $false }
    Set-ShapeStyle $token $tokenSpec $Scale
    $created.Add($token) | Out-Null
  }
  return $created.ToArray()
}

function Draw-StateInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LinePattern").FormulaU = "2"
  $stateLabel = $Page.DrawRectangle($X + $W * 0.18, $Y + $H * 0.38, $X + $W * 0.82, $Y + $H * 0.62)
  $stateLabel.Text = "h / c"
  $stateLabel.CellsU("FillPattern").FormulaU = "0"
  $stateLabel.CellsU("LinePattern").FormulaU = "0"
  $stateLabel.CellsU("Char.Size").FormulaU = "8 pt"
  Set-PlanData $stateLabel $Spec.shapeData
  return @($shape, $stateLabel)
}

function Draw-VectorInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $count = 6
  try { if ([int]$Spec.shapeData.tensorRank -gt 0) { $count = [Math]::Max(4, [Math]::Min(10, [int]$Spec.shapeData.tensorRank * 2)) } } catch {}
  for ($index = 0; $index -lt $count; $index += 1) {
    $barHeight = [Math]::Max(0.08, $H * (0.25 + (($index * 13) % 60) / 100))
    $bar = $Page.DrawRectangle($X + $W * 0.18, $Y + $H - $barHeight - $index * 0.01, $X + $W * 0.82, $Y + $H - $index * 0.01)
    $barSpec = [pscustomobject]@{ label = if ($index -eq 0) { $Spec.label } else { "" }; subtitle = if ($index -eq 0) { $Spec.subtitle } else { "" }; fill = $Spec.fill; line = $Spec.line; shapeKind = "vector-component"; visualRole = $Spec.visualRole; styleProfile = "vector-input"; shapeData = $Spec.shapeData; labelOutside = if ($index -eq 0) { $Spec.labelOutside } else { $false } }
    Set-ShapeStyle $bar $barSpec $Scale
    $created.Add($bar) | Out-Null
  }
  return $created.ToArray()
}

function Draw-VolumeInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $depth = [Math]::Max(0.12, [Math]::Min(0.42, $W * 0.45))
  return @(Draw-PublicationTensorTensorBox $Page $X $Y $W $H $depth $Spec $Scale "volume-input" $true)
}

function Draw-UnknownInput([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $cut = [Math]::Min($W * 0.2, $H * 0.16)
  $points = [double[]]@(
    ($X + $cut), $Y,
    ($X + $W - $cut), $Y,
    ($X + $W), ($Y + $H / 2),
    ($X + $W - $cut), ($Y + $H),
    ($X + $cut), ($Y + $H),
    $X, ($Y + $H / 2),
    ($X + $cut), $Y
  )
  $shape = $Page.DrawPolyline($points, 0)
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LinePattern").FormulaU = "2"
  return @($shape)
}

function Draw-FeatureMapStack([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $repeatCount = Get-RepeatCount $Spec
  # PublicationTensor RightBandedBox: repeated operators are contiguous tensor
  # cells along x.  Tensor depth follows the spatial height, never card width.
  $cellCount = $repeatCount
  $cellWidth = $W / $cellCount
  $depth = $H
  for ($cellIndex = 0; $cellIndex -lt $cellCount; $cellIndex += 1) {
    $cellSpec = [pscustomobject]@{
      label = ""
      subtitle = ""
      fill = $Spec.fill
      line = $Spec.line
      shapeKind = "feature-map-cell"
      visualRole = "feature-map-stage"
      styleProfile = "feature-map"
      labelOutside = $false
      shapeData = $Spec.shapeData
      fillOpacity = 0.62
    }
    foreach ($shape in @(Draw-RightBandedTensorCell $Page ($X + ($cellIndex * $cellWidth)) $Y $cellWidth $H $depth $cellSpec $Scale ($cellIndex -eq ($cellCount - 1)))) {
      $created.Add($shape) | Out-Null
    }
  }
  return $created.ToArray()
}

function Draw-RightBandedTensorCell([object]$Page, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Depth, [object]$Spec, [double]$Scale, [bool]$IsLast) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($face in @(Draw-PublicationTensorTensorBox $Page $X $Y $W $H $Depth $Spec $Scale "feature-map-cell" $IsLast)) {
    $created.Add($face) | Out-Null
  }
  # Direct translation of RightBandedBox: the right third has a distinct
  # near-face and top-face band, while only the final cell owns an east face.
  $bandWidth = [Math]::Max(0.018, $W / 3)
  $bandX = $X + $W - $bandWidth
  $bandSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#E65034"; line = "#802218"; shapeKind = "feature-map-band"; visualRole = "feature-map-stage"; styleProfile = "feature-map-band"; shapeData = $Spec.shapeData; faceRole = "front"; fillOpacity = 0.6 }
  $originX = $X + (0.385 * $Depth / 2)
  $originY = $Y + (0.385 * $Depth / 2)
  $halfDepth = $Depth / 2
  $art = Project-PublicationTensorTensorPoint $originX $originY ($W - $bandWidth) $H $halfDepth
  $brt = Project-PublicationTensorTensorPoint $originX $originY ($W - $bandWidth) 0 $halfDepth
  $a = Project-PublicationTensorTensorPoint $originX $originY 0 $H $halfDepth
  $b = Project-PublicationTensorTensorPoint $originX $originY 0 0 $halfDepth
  $c = Project-PublicationTensorTensorPoint $originX $originY $W 0 $halfDepth
  $d = Project-PublicationTensorTensorPoint $originX $originY $W $H $halfDepth
  $e = Project-PublicationTensorTensorPoint $originX $originY $W $H (-$halfDepth)
  $f = Project-PublicationTensorTensorPoint $originX $originY $W 0 (-$halfDepth)
  $pointH = Project-PublicationTensorTensorPoint $originX $originY 0 $H (-$halfDepth)
  $hrt = Project-PublicationTensorTensorPoint $originX $originY ($W - $bandWidth) $H (-$halfDepth)
  $band = Draw-PublicationTensorPolygon $Page @($d, $art, $brt, $c) $bandSpec $Scale
  $created.Add($band) | Out-Null
  $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#E65034"; line = "#802218"; shapeKind = "feature-map-band-top"; visualRole = "feature-map-stage"; styleProfile = "feature-map-band"; shapeData = $Spec.shapeData; faceRole = "top"; fillOpacity = 0.6 }
  $top = Draw-PublicationTensorPolygon $Page @($d, $art, $hrt, $e) $topSpec $Scale
  $created.Add($top) | Out-Null
  # RightBandedBox redraws its body outlines after the translucent band.
  $outlineSpec = New-PublicationTensorFaceSpec $Spec "feature-map-cell-outline" "front" 0
  foreach ($outline in @(
      (Draw-PublicationTensorPolygon $Page @($d, $a, $b, $c) $outlineSpec $Scale),
      (Draw-PublicationTensorPolygon $Page @($d, $a, $pointH, $e) $outlineSpec $Scale)
    )) {
    $created.Add($outline) | Out-Null
  }
  if ($IsLast) {
    $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#E65034"; line = "#802218"; shapeKind = "feature-map-band-side"; visualRole = "feature-map-stage"; styleProfile = "feature-map-band"; shapeData = $Spec.shapeData; faceRole = "side"; fillOpacity = 0.6 }
    $side = Draw-PublicationTensorPolygon $Page @($d, $e, $f, $c) $sideSpec $Scale
    $created.Add($side) | Out-Null
  }
  return $created.ToArray()
}

function Draw-FeatureMapGrid([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # Input-only image cue; intermediate maps deliberately avoid a full grid.
  $created = New-Object 'System.Collections.Generic.List[object]'
  $lineCount = 3
  for ($index = 1; $index -le $lineCount; $index += 1) {
    $ratio = [double]$index / [double]($lineCount + 1)
    $vertical = $Page.DrawLine($X + ($W * $ratio), $Y, $X + ($W * $ratio), $Y + $H)
    $vertical.CellsU("LineColor").FormulaU = "RGB(178,201,217)"
    $vertical.CellsU("LineWeight").FormulaU = "0.004 in"
    Set-PlanData $vertical ([pscustomobject]@{
      renderId = $Spec.shapeData.renderId
      visualRole = "input-grid"
      sourceNodeId = ""
      parentNodeId = $Spec.shapeData.sourceNodeId
      gridAxis = "vertical"
    })
    $created.Add($vertical) | Out-Null
    $horizontal = $Page.DrawLine($X, $Y + ($H * $ratio), $X + $W, $Y + ($H * $ratio))
    $horizontal.CellsU("LineColor").FormulaU = "RGB(178,201,217)"
    $horizontal.CellsU("LineWeight").FormulaU = "0.004 in"
    Set-PlanData $horizontal ([pscustomobject]@{
      renderId = $Spec.shapeData.renderId
      visualRole = "input-grid"
      sourceNodeId = ""
      parentNodeId = $Spec.shapeData.sourceNodeId
      gridAxis = "horizontal"
    })
    $created.Add($horizontal) | Out-Null
  }
  return $created.ToArray()
}

function Draw-DownsampleFrustum([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $scaleChange = (Get-PlanString $Spec.shapeData.scaleChange).ToLowerInvariant()
  $isExpand = $scaleChange -eq "expand"
  $targetHeight = if ($isExpand) { $H } else { $H * 0.72 }
  $depth = if ($isExpand) { [Math]::Max($W * 0.25, $H * 0.22) } else { [Math]::Max($W * 0.18, $targetHeight * 0.75) }
  $visualRole = if ($isExpand) { "upsample" } else { "pool-downsample" }
  $styleProfile = if ($isExpand) { "upsample" } else { "pool" }
  $shapeKind = if ($isExpand) { "upsample-box" } else { "pool-box" }
  # PublicationTensor uses two different native primitives for resolution
  # changes: a smaller Box for downsampling, a larger Box for upsampling.
  $scaleSpec = [pscustomobject]@{ label = $Spec.label; subtitle = $Spec.subtitle; fill = $Spec.fill; line = $Spec.line; shapeKind = $shapeKind; visualRole = $visualRole; styleProfile = $styleProfile; labelOutside = $Spec.labelOutside; shapeData = $Spec.shapeData; fillOpacity = 0.5 }
  return @(Draw-PublicationTensorTensorBox $Page $X $Y $W $targetHeight $depth $scaleSpec $Scale $shapeKind $true)
}

function Draw-NeuronColumn([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $frame = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  $frameSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "neuron-column"; visualRole = "neuron-layer"; styleProfile = "neuron"; shapeData = $Spec.shapeData; faceRole = "front" }
  Set-ShapeStyle $frame $frameSpec $Scale
  $created.Add($frame) | Out-Null
  $dotCount = 7
  $dotSize = [Math]::Max(0.045, [Math]::Min(0.085, $W * 0.42))
  $usableHeight = [Math]::Max($dotSize, $H - $dotSize * 2.5)
  for ($index = 0; $index -lt $dotCount; $index += 1) {
    $centerY = $Y + $dotSize * 1.25 + ($usableHeight * $index / ($dotCount - 1))
    $dot = $Page.DrawOval($X + (($W - $dotSize) / 2), $centerY - ($dotSize / 2), $X + (($W + $dotSize) / 2), $centerY + ($dotSize / 2))
    $dotSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#4C0F5A"; line = "#3A0B45"; shapeKind = "neuron"; visualRole = "neuron-layer"; styleProfile = "operator"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $dot $dotSpec $Scale
    $created.Add($dot) | Out-Null
  }
  return $created.ToArray()
}

function Draw-OutputDistribution([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $depth = [Math]::Max(0.05, [Math]::Min(0.12, $W * 0.24))
  $panelSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = "output-distribution"; visualRole = "output-distribution"; styleProfile = "output"; shapeData = $Spec.shapeData; labelOutside = $Spec.labelOutside }
  foreach ($face in @(Draw-PrismFaces $Page $X $Y $W $H $depth $panelSpec $Scale "output-distribution")) {
    $created.Add($face) | Out-Null
  }
  $barCount = 6
  $barH = [Math]::Max(0.025, $H * 0.055)
  for ($index = 0; $index -lt $barCount; $index += 1) {
    $barY = $Y + $H * (0.15 + $index * 0.125)
    $barW = $W * (0.28 + ((($index * 17) % 53) / 100))
    $bar = $Page.DrawRectangle($X + $W * 0.13, $barY, $X + $W * 0.13 + $barW, $barY + $barH)
    $barSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#EAC0EF"; line = "#5B176A"; shapeKind = "output-score-bar"; visualRole = "output-distribution"; styleProfile = "operator"; shapeData = $Spec.shapeData }
    Set-ShapeStyle $bar $barSpec $Scale
    $created.Add($bar) | Out-Null
  }
  return $created.ToArray()
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
  # Vectorization is a short horizontal funnel: retain the source tensor
  # height at the left edge and end at a non-zero vector height, instead of
  # collapsing into a generic card or a point triangle.
  $targetHeight = [Math]::Max(0.08, $H * 0.22)
  $centerY = $Y + ($H / 2)
  $leftTop = $Y + $H
  $rightTop = $centerY + ($targetHeight / 2)
  $rightBottom = $centerY - ($targetHeight / 2)
  $points = [double[]]@(
    [double]$X, [double]$Y,
    [double]$X, $leftTop,
    ([double]$X + [double]$W), $rightTop,
    ([double]$X + [double]$W), $rightBottom,
    [double]$X, [double]$Y
  )
  $front = $Page.DrawPolyline($points, 0)
  $frontSpec = [pscustomobject]@{
    label = ""
    subtitle = ""
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = "vectorize-funnel"
    visualRole = "vectorize"
    styleProfile = "vectorize"
    labelOutside = $Spec.labelOutside
    shapeData = $Spec.shapeData
    faceRole = "front"
  }
  Set-ShapeStyle $front $frontSpec $Scale
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($front) | Out-Null
  return $created.ToArray()
}

function Draw-TextAnnotation([object]$Page, [string]$Text, [double]$X, [double]$Y, [double]$W, [double]$H, [string]$FontSize, [string]$RenderId, [string]$ParentNodeId, [string]$VisualRole) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  $shape.Text = $Text
  $shape.CellsU("FillPattern").FormulaU = "0"
  $shape.CellsU("LinePattern").FormulaU = "0"
  $shape.CellsU("Char.Size").FormulaU = $FontSize
  if ($VisualRole -eq "figure-label") { $shape.CellsU("Char.Style").FormulaU = "1" }
  $shape.CellsU("Char.Color").FormulaU = "RGB(38,50,60)"
  $shape.CellsU("Para.HorzAlign").FormulaU = "1"
  $shape.CellsU("VerticalAlign").FormulaU = "1"
  Set-PlanData $shape ([pscustomobject]@{
    renderId = $RenderId
    visualRole = $VisualRole
    sourceNodeId = ""
    parentNodeId = $ParentNodeId
  })
  return $shape
}

function Draw-PlanLabel([object]$Page, [object]$Spec, [double]$Scale) {
  if (-not [string]::IsNullOrWhiteSpace((Get-PlanString $Spec.parentNodeId))) { return @() }
  if (-not [string]::IsNullOrWhiteSpace((Get-PlanString $Spec.sceneForm))) { return @() }
  $visualRole = Get-PlanString $Spec.visualRole
  if ($visualRole -eq "repeat-marker" -or $visualRole -eq "annotation") { return @() }
  # Publication blocks carry their title and shape inside the card; no
  # external label is needed.
  if ((Get-PlanString $Spec.shapeKind) -eq "publication-block") { return @() }
  $labels = New-Object 'System.Collections.Generic.List[object]'
  $x = [double]$Spec.x * $Scale
  $y = [double]$Spec.y * $Scale
  $w = [double]$Spec.w * $Scale
  $h = [double]$Spec.h * $Scale
  # The render plan carries the compiled slots in Shape Data so the native
  # bridge does not need to reconstruct semantic grammar from model names.
  # Keep the labelSlots fallback for plans produced before this contract.
  $labelTitleSlot = Get-PlanString $Spec.shapeData.labelTitleSlot
  $labelSubtitleSlot = Get-PlanString $Spec.shapeData.labelSubtitleSlot
  if ([string]::IsNullOrWhiteSpace($labelTitleSlot)) { $labelTitleSlot = Get-PlanString $Spec.labelSlots.title }
  if ([string]::IsNullOrWhiteSpace($labelSubtitleSlot)) { $labelSubtitleSlot = Get-PlanString $Spec.labelSlots.subtitle }
  $titleSlot = $labelTitleSlot
  $subtitleSlot = $labelSubtitleSlot
  if ([string]::IsNullOrWhiteSpace($titleSlot)) { $titleSlot = "above" }
  if ([string]::IsNullOrWhiteSpace($subtitleSlot)) { $subtitleSlot = "below" }
  $titleY = if ($titleSlot -eq "below") { $y - 0.25 } else { $y + $h + 0.36 }
  $subtitleY = if ($subtitleSlot -eq "above") { $y + $h + 0.02 } else { $y - 0.5 }
  # Thin neural-network primitives need independent label width; otherwise
  # channel counts are split by the narrow feature-map body itself.
  $labelWidth = [Math]::Max(0.88, $w + 0.36)
  $labelX = $x - 0.18
  if ($visualRole -eq "pool-downsample") {
    $labelWidth = [Math]::Max(0.92, $w + 0.62)
    $labelX = $x + (($w - $labelWidth) / 2)
    $titleY = $y - 0.38
  }
  $title = Draw-TextAnnotation $Page (Get-PlanString $Spec.label) $labelX $titleY $labelWidth 0.2 "10 pt" ([string]$Spec.shapeData.renderId) ([string]$Spec.shapeData.sourceNodeId) "figure-label"
  if ($null -ne $title) { $labels.Add($title) | Out-Null }
  $subtitleText = Get-PlanString $Spec.subtitle
  if ($visualRole -eq "pool-downsample") { $subtitleText = "" }
  if ($subtitleText -notmatch "`r?`n" -and $subtitleText -match "\s·\s") {
    $subtitleText = $subtitleText -replace "\s+·\s+", "`n· "
  }
  if (-not [string]::IsNullOrWhiteSpace($subtitleText)) {
    $subtitle = Draw-TextAnnotation $Page $subtitleText $labelX $subtitleY $labelWidth 0.32 "7 pt" ([string]$Spec.shapeData.renderId) ([string]$Spec.shapeData.sourceNodeId) "figure-dimension"
    if ($null -ne $subtitle) { $labels.Add($subtitle) | Out-Null }
  }
  return $labels.ToArray()
}

function Draw-CompoundModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # The outer frame is a topology container; its evidenced child graph is
  # drawn separately by Draw-PlanShape and remains visible inside this frame.
  $points = [double[]]@(
    $X, $Y,
    ($X + $W - 0.08), $Y,
    ($X + $W), ($Y + 0.08),
    ($X + $W), ($Y + $H - 0.08),
    ($X + $W - 0.08), ($Y + $H),
    $X, ($Y + $H),
    $X, $Y
  )
  $frame = $Page.DrawPolyline($points, 0)
  $frameSpec = [pscustomobject]@{
    label = ""
    subtitle = ""
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = "compound-frame"
    visualRole = "compound-module"
    styleProfile = "compound"
    labelOutside = $true
    shapeData = $Spec.shapeData
    faceRole = "front"
  }
  Set-ShapeStyle $frame $frameSpec $Scale
  $frame.CellsU("FillForegndTrans").FormulaU = "35%"
  $frame.CellsU("FillBkgndTrans").FormulaU = "35%"
  $frame.CellsU("LinePattern").FormulaU = "2"
  return @($frame)
}

function Draw-StructuredModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale, [string]$Pattern) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($shape in @(Draw-CompoundModule $Page $Spec $X $Y $W $H $Scale)) { $created.Add($shape) | Out-Null }
  return $created.ToArray()
}

function Draw-GroupContainer([object]$Page, [object]$Group, [double]$Scale) {
  if ($null -eq $Group.bounds) { return @() }
  $x = [double]([double]$Group.bounds.x * [double]$Scale)
  $y = [double]([double]$Group.bounds.y * [double]$Scale)
  $w = [double]([double]$Group.bounds.w * [double]$Scale)
  $h = [double]([double]$Group.bounds.h * [double]$Scale)
  $kind = (Get-PlanString $Group.kind).ToLowerInvariant()
  $fill = switch ($kind) {
    "backbone" { "#E9F1F8"; break }
    "neck" { "#EAF6EF"; break }
    "head" { "#FCF0DF"; break }
    "stage" { "#F1EBF9"; break }
    default { "#F2F4F6" }
  }
  $lineColor = switch ($kind) {
    "backbone" { "#5B86A6"; break }
    "neck" { "#5B9E78"; break }
    "head" { "#C08A3E"; break }
    "stage" { "#7A5BA6"; break }
    default { "#8A97A6" }
  }
  $cut = [Math]::Min($w * 0.015, 0.22)
  $points = [double[]]@(
    ($x + $cut), $y,
    ($x + $w - $cut), $y,
    ($x + $w), ($y + $cut),
    ($x + $w), ($y + $h - $cut),
    ($x + $w - $cut), ($y + $h),
    ($x + $cut), ($y + $h),
    $x, ($y + $h - $cut),
    $x, ($y + $cut),
    ($x + $cut), $y
  )
  $frame = $Page.DrawPolyline($points, 0)
  $frame.Text = (Get-PlanString $Group.label)
  $frame.CellsU("FillForegnd").FormulaU = Get-RgbFormula $fill
  $frame.CellsU("FillBkgnd").FormulaU = Get-RgbFormula $fill
  $frame.CellsU("FillForegndTrans").FormulaU = "68%"
  $frame.CellsU("FillBkgndTrans").FormulaU = "68%"
  $frame.CellsU("LineColor").FormulaU = Get-RgbFormula $lineColor
  $frame.CellsU("LineWeight").FormulaU = "0.009 in"
  $frame.CellsU("LinePattern").FormulaU = "2"
  $frame.CellsU("Char.Size").FormulaU = "9 pt"
  $frame.CellsU("Char.Style").FormulaU = "1"
  $frame.CellsU("Char.Color").FormulaU = Get-RgbFormula $lineColor
  $frame.CellsU("Para.HorzAlign").FormulaU = "1"
  $frame.CellsU("VerticalAlign").FormulaU = "0"
  Set-ShapeData $frame "renderId" ([string]$Group.renderId)
  Set-ShapeData $frame "groupKind" ([string]$kind)
  Set-ShapeData $frame "groupLabel" ([string]$Group.label)
  return @($frame)
}

function Draw-UnresolvedModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # A hexagonal uncertainty glyph records that structure is missing instead
  # of pretending that an opaque module is a known rectangular block.
  $cut = [Math]::Min($W * 0.22, $H * 0.18)
  $points = [double[]]@(
    ($X + $cut), $Y,
    ($X + $W - $cut), $Y,
    ($X + $W), ($Y + $H / 2),
    ($X + $W - $cut), ($Y + $H),
    ($X + $cut), ($Y + $H),
    $X, ($Y + $H / 2),
    ($X + $cut), $Y
  )
  $glyph = $Page.DrawPolyline($points, 0)
  $glyphSpec = [pscustomobject]@{
    label = $Spec.label
    subtitle = $Spec.subtitle
    fill = $Spec.fill
    line = $Spec.line
    shapeKind = "unresolved-glyph"
    visualRole = "unresolved-module"
    styleProfile = "unresolved"
    labelOutside = $Spec.labelOutside
    shapeData = $Spec.shapeData
    faceRole = "front"
  }
  Set-ShapeStyle $glyph $glyphSpec $Scale
  $glyph.CellsU("LinePattern").FormulaU = "2"
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($glyph) | Out-Null
  foreach ($marker in @(Draw-RecurrentPortMarkers $Page $Spec $X $Y $W $H $Scale $true)) {
    if ($null -ne $marker) { $created.Add($marker) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-RecurrentPortMarkers([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale, [bool]$Unresolved) {
  # Port markers are evidence labels, not an invented cell schematic. They
  # make the known contract visible even when the source does not expose the
  # recurrent operator's internal gates.
  $created = New-Object 'System.Collections.Generic.List[object]'
  $inputs = @(Get-PlanString $Spec.shapeData.inputPorts -split '\|' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $outputs = @(Get-PlanString $Spec.shapeData.outputPorts -split '\|' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $inputCount = [Math]::Max(1, $inputs.Count)
  $outputCount = [Math]::Max(1, $outputs.Count)
  $markerW = [Math]::Max(0.16, [Math]::Min(0.34, $W * 0.11))
  $markerH = [Math]::Max(0.10, [Math]::Min(0.18, $H * 0.055))
  for ($index = 0; $index -lt $inputs.Count; $index += 1) {
    $label = [string]$inputs[$index]
    $centerY = $Y + ($H * ($index + 1) / ($inputCount + 1))
    $port = $Page.DrawOval($X - ($markerW / 2), $centerY - ($markerH / 2), $X + ($markerW / 2), $centerY + ($markerH / 2))
    $portSpec = [pscustomobject]@{ label = $label; subtitle = ""; fill = if ($label -match '(^|_)(h|c)(_|$)|state|hidden|cell' ) { "#E8DDF5" } else { "#E2EEF8" }; line = "#46647E"; shapeKind = "recurrent-port"; visualRole = "recurrent-port"; styleProfile = "recurrent-port"; shapeData = $Spec.shapeData; labelOutside = $false }
    Set-ShapeStyle $port $portSpec $Scale
    $port.CellsU("Char.Size").FormulaU = "6 pt"
    $created.Add($port) | Out-Null
    $caption = Draw-TextAnnotation $Page $label ($X - ($markerW * 2.9)) ($centerY - ($markerH * 0.7)) ($markerW * 2.2) ($markerH * 1.4) "6 pt" ([string]$Spec.shapeData.renderId) ([string]$Spec.shapeData.sourceNodeId) "recurrent-input-port"
    if ($null -ne $caption) { $created.Add($caption) | Out-Null }
  }
  for ($index = 0; $index -lt $outputs.Count; $index += 1) {
    $label = [string]$outputs[$index]
    $centerY = $Y + ($H * ($index + 1) / ($outputCount + 1))
    $port = $Page.DrawOval($X + $W - ($markerW / 2), $centerY - ($markerH / 2), $X + $W + ($markerW / 2), $centerY + ($markerH / 2))
    $portSpec = [pscustomobject]@{ label = $label; subtitle = ""; fill = "#D8F3DC"; line = "#467A5B"; shapeKind = "recurrent-port"; visualRole = "recurrent-port"; styleProfile = "recurrent-port"; shapeData = $Spec.shapeData; labelOutside = $false }
    Set-ShapeStyle $port $portSpec $Scale
    $port.CellsU("Char.Size").FormulaU = "6 pt"
    $created.Add($port) | Out-Null
    $caption = Draw-TextAnnotation $Page $label ($X + $W + ($markerW * 0.7)) ($centerY - ($markerH * 0.7)) ($markerW * 2.2) ($markerH * 1.4) "6 pt" ([string]$Spec.shapeData.renderId) ([string]$Spec.shapeData.sourceNodeId) "recurrent-output-port"
    if ($null -ne $caption) { $created.Add($caption) | Out-Null }
  }
  if ($Unresolved) {
    $unknown = $Page.DrawOval($X + ($W * 0.38), $Y + ($H * 0.34), $X + ($W * 0.62), $Y + ($H * 0.58))
    $unknown.Text = "?"
    $unknown.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#FFF4CC"
    $unknown.CellsU("FillBkgnd").FormulaU = Get-RgbFormula "#FFF4CC"
    $unknown.CellsU("LineColor").FormulaU = Get-RgbFormula "#B27A00"
    $unknown.CellsU("Char.Size").FormulaU = "16 pt"
    $unknown.CellsU("Char.Style").FormulaU = "1"
    $unknown.CellsU("Para.HorzAlign").FormulaU = "1"
    $unknown.CellsU("VerticalAlign").FormulaU = "1"
    Set-PlanData $unknown $Spec.shapeData
    $created.Add($unknown) | Out-Null
    $note = Draw-TextAnnotation $Page "structure unresolved" ($X + ($W * 0.2)) ($Y + ($H * 0.68)) ($W * 0.6) 0.2 "7 pt" ([string]$Spec.shapeData.renderId) ([string]$Spec.shapeData.sourceNodeId) "uncertainty-note"
    if ($null -ne $note) { $created.Add($note) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-RecurrentInstance([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $expanded = [bool]$Spec.recurrentExpanded
  if ($expanded -and -not [string]::IsNullOrWhiteSpace((Get-PlanString $Spec.shapeData.unresolvedReason))) {
    return @(Draw-UnresolvedModule $Page $Spec $X $Y $W $H $Scale)
  }
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  $instanceSpec = [pscustomobject]@{
    label = $Spec.label
    subtitle = $Spec.subtitle
    fill = if ($expanded) { "#D8F3DC" } else { "#DDE7F2" }
    line = if ($expanded) { "#D18B00" } else { "#6B7C93" }
    shapeKind = "recurrent-instance"
    visualRole = "recurrent-instance"
    styleProfile = if ($expanded) { "recurrent-expanded" } else { "recurrent-collapsed" }
    labelOutside = $false
    shapeData = $Spec.shapeData
  }
  Set-ShapeStyle $shape $instanceSpec $Scale
  if (-not $expanded) { $shape.CellsU("LinePattern").FormulaU = "2" }
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($shape) | Out-Null
  foreach ($marker in @(Draw-RecurrentPortMarkers $Page $Spec $X $Y $W $H $Scale $false)) {
    if ($null -ne $marker) { $created.Add($marker) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-OperatorGlyph([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $glyph = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $glyph $Spec $Scale
  return @($glyph)
}

function Draw-AttentionModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $body = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $body $Spec $Scale
  $body.CellsU("Rounding").FormulaU = "0.06 in"
  $body.Text = ""
  $created.Add($body) | Out-Null
  $padding = [Math]::Max(0.035, [Math]::Min($W, $H) * 0.12)
  $tokenW = ($W - $padding * 2) * 0.42
  $tokenH = ($H - $padding * 2) / 5
  foreach ($index in 0..2) {
    $tokenY = $Y + $padding + $index * ($tokenH + $tokenH * 0.25)
    $token = $Page.DrawRectangle($X + $padding, $tokenY, $X + $padding + $tokenW, $tokenY + $tokenH)
    $token.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#DCEAF4"
    $token.CellsU("FillBkgnd").FormulaU = Get-RgbFormula "#DCEAF4"
    $token.CellsU("LineColor").FormulaU = Get-RgbFormula "#6E91AA"
    $token.CellsU("LineWeight").FormulaU = "0.005 in"
    $token.Text = ""
    Set-PlanData $token $Spec.shapeData
    $created.Add($token) | Out-Null
  }
  $gridX = $X + $padding + $tokenW + $padding
  $gridY = $Y + $padding
  $gridW = $W - ($gridX - $X) - $padding
  $gridH = $H - $padding * 2
  $grid = $Page.DrawRectangle($gridX, $gridY, $gridX + $gridW, $gridY + $gridH)
  $grid.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $grid.CellsU("FillBkgnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $grid.CellsU("LineColor").FormulaU = Get-RgbFormula "#7E5CA4"
  $grid.CellsU("LineWeight").FormulaU = "0.006 in"
  $grid.Text = ""
  Set-PlanData $grid $Spec.shapeData
  $created.Add($grid) | Out-Null
  foreach ($ratio in @((1.0 / 3.0), (2.0 / 3.0))) {
    $vertical = $Page.DrawLine($gridX + $gridW * $ratio, $gridY, $gridX + $gridW * $ratio, $gridY + $gridH)
    $vertical.CellsU("LineColor").FormulaU = Get-RgbFormula "#B9A6D4"
    $vertical.CellsU("LineWeight").FormulaU = "0.004 in"
    Set-PlanData $vertical $Spec.shapeData
    $created.Add($vertical) | Out-Null
    $horizontal = $Page.DrawLine($gridX, $gridY + $gridH * $ratio, $gridX + $gridW, $gridY + $gridH * $ratio)
    $horizontal.CellsU("LineColor").FormulaU = Get-RgbFormula "#B9A6D4"
    $horizontal.CellsU("LineWeight").FormulaU = "0.004 in"
    Set-PlanData $horizontal $Spec.shapeData
    $created.Add($horizontal) | Out-Null
  }
  return $created.ToArray()
}

function Draw-NormModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $body = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $body $Spec $Scale
  $body.Text = ""
  $created.Add($body) | Out-Null
  $midY = $Y + $H / 2
  $lineA = $Page.DrawLine($X + $W * 0.25, $midY - ($H * 0.10), $X + $W * 0.75, $midY - ($H * 0.10))
  $lineA.CellsU("LineColor").FormulaU = Get-RgbFormula "#3F5D78"
  $lineA.CellsU("LineWeight").FormulaU = "0.008 in"
  Set-PlanData $lineA $Spec.shapeData
  $created.Add($lineA) | Out-Null
  $lineB = $Page.DrawLine($X + $W * 0.25, $midY + ($H * 0.10), $X + $W * 0.75, $midY + ($H * 0.10))
  $lineB.CellsU("LineColor").FormulaU = Get-RgbFormula "#3F5D78"
  $lineB.CellsU("LineWeight").FormulaU = "0.008 in"
  Set-PlanData $lineB $Spec.shapeData
  $created.Add($lineB) | Out-Null
  return $created.ToArray()
}

function Draw-InnerOperatorShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $role = Get-PlanString $Spec.visualRole
  if ($role -eq "inner-capsule") {
    $shape = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  } elseif ($role -eq "inner-attention") {
    $cut = [Math]::Min($W * 0.18, $H * 0.28)
    $points = [double[]]@(
      ($X + $cut), $Y, ($X + $W - $cut), $Y,
      ($X + $W), ($Y + $H / 2),
      ($X + $W - $cut), ($Y + $H), ($X + $cut), ($Y + $H),
      $X, ($Y + $H / 2), ($X + $cut), $Y
    )
    $shape = $Page.DrawPolyline($points, 0)
  } else {
    $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  }
  Set-ShapeStyle $shape $Spec $Scale
  $shape.CellsU("LineWeight").FormulaU = "0.009 in"
  $shape.CellsU("Char.Size").FormulaU = "7 pt"
  Set-NativeShapeIdentity $shape $Spec.id
  return @($shape)
}

function Draw-DecisionShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $points = [double[]]@(
    ($X + ($W / 2)), $Y,
    ($X + $W), ($Y + ($H / 2)),
    ($X + ($W / 2)), ($Y + $H),
    $X, ($Y + ($H / 2)),
    ($X + ($W / 2)), $Y
  )
  $shape = $Page.DrawPolyline($points, 0)
  Set-ShapeStyle $shape $Spec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  return @($shape)
}

function Draw-MergeAddShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  if ([string]::IsNullOrWhiteSpace((Get-PlanString $Spec.label))) { $shape.Text = "+" }
  $shape.CellsU("Char.Size").FormulaU = "10 pt"
  $shape.CellsU("Char.Style").FormulaU = "1"
  return @($shape)
}

function Draw-MergeConcatShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $barWidth = [Math]::Max(0.035, $W * 0.08)
  $barX = $X + ($W * 0.62)
  $bar = $Page.DrawRectangle($barX, $Y + ($H * 0.12), $barX + $barWidth, $Y + ($H * 0.88))
  $bar.CellsU("FillForegnd").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $bar.CellsU("FillBkgnd").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $bar.CellsU("LinePattern").FormulaU = "0"
  $bar.Text = ""
  Set-NativeShapeIdentity $bar $Spec.id
  Set-PlanData $bar $Spec.shapeData
  $created.Add($bar) | Out-Null
  foreach ($ratio in @(0.24, 0.50, 0.76)) {
    $line = $Page.DrawLine($X + ($W * 0.12), $Y + ($H * $ratio), $barX, $Y + ($H * $ratio))
    $line.CellsU("LineColor").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
    $line.CellsU("LineWeight").FormulaU = "0.011 in"
    Set-PlanData $line $Spec.shapeData
    $created.Add($line) | Out-Null
  }
  $out = $Page.DrawLine($barX + $barWidth, $Y + ($H * 0.50), $X + ($W * 0.88), $Y + ($H * 0.50))
  $out.CellsU("LineColor").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $out.CellsU("LineWeight").FormulaU = "0.011 in"
  $out.CellsU("EndArrow").FormulaU = "13"
  Set-PlanData $out $Spec.shapeData
  $created.Add($out) | Out-Null
  return $created.ToArray()
}

function Draw-SplitShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $points = [double[]]@(
    $X, $Y,
    ($X + $W), ($Y + ($H / 2)),
    $X, ($Y + $H),
    $X, $Y
  )
  $shape = $Page.DrawPolyline($points, 0)
  $glyphSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = $Spec.fill; line = $Spec.line; shapeKind = $Spec.shapeKind; visualRole = $Spec.visualRole; styleProfile = $Spec.styleProfile; shapeData = $Spec.shapeData; labelOutside = $false }
  Set-ShapeStyle $shape $glyphSpec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  return @($shape)
}

function Draw-JunctionShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  $shape.Text = ""
  $shape.CellsU("LinePattern").FormulaU = "0"
  return @($shape)
}

function Draw-RepeatMarkerShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  $count = Get-RepeatCount $Spec
  $label = Get-PlanString $Spec.label
  if ([string]::IsNullOrWhiteSpace($label)) { $label = "$count`u{00D7}" }
  $shape.Text = $label
  $shape.CellsU("FillPattern").FormulaU = "0"
  $shape.CellsU("LinePattern").FormulaU = "0"
  $shape.CellsU("Char.Style").FormulaU = "1"
  return @($shape)
}

function Draw-AnnotationShape([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $shape = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $shape $Spec $Scale
  Set-NativeShapeIdentity $shape $Spec.id
  $shape.CellsU("FillPattern").FormulaU = "0"
  $shape.CellsU("LinePattern").FormulaU = "0"
  return @($shape)
}

function Draw-PublicationBlock([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # Publication cards are intentionally quiet: rounded rectangular body,
  # semantic side rail, operator label, and a small tensor-shape subtitle.
  $visualRole = Get-PlanString $Spec.visualRole
  $block = $Page.DrawRectangle($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $block $Spec $Scale
  $block.CellsU("Rounding").FormulaU = "0.08 in"
  $block.CellsU("Char.Size").FormulaU = "8 pt"
  $block.CellsU("Char.Style").FormulaU = "1"
  $label = Get-PlanString $Spec.label
  if ($visualRole -eq "upsample") { $label = "`u{2191} $label" }
  elseif ($visualRole -eq "pool-downsample") { $label = "`u{2193} $label" }
  $subtitle = Get-PlanString $Spec.subtitle
  $block.Text = if (-not [string]::IsNullOrWhiteSpace($subtitle)) { "$label`n$subtitle" } else { $label }
  $railW = [Math]::Max(0.035, [Math]::Min(0.075, $W * 0.055))
  $rail = $Page.DrawRectangle($X, $Y, $X + $railW, $Y + $H)
  $rail.CellsU("FillForegnd").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $rail.CellsU("FillBkgnd").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $rail.CellsU("LinePattern").FormulaU = "0"
  $rail.Text = ""
  Set-PlanData $rail $Spec.shapeData
  return @($block, $rail)
}

function Draw-NamedModule([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $label = Get-PlanString $Spec.label
  $cut = [Math]::Min($W * 0.14, $H * 0.16)
  $points = [double[]]@(
    ($X + $cut), $Y,
    ($X + $W - $cut), $Y,
    ($X + $W), ($Y + $cut),
    ($X + $W), ($Y + $H - $cut),
    ($X + $W - $cut), ($Y + $H),
    ($X + $cut), ($Y + $H),
    $X, ($Y + $H - $cut),
    $X, ($Y + $cut),
    ($X + $cut), $Y
  )
  $block = $Page.DrawPolyline($points, 0)
  Set-ShapeStyle $block $Spec $Scale
  $block.CellsU("LineWeight").FormulaU = "0.011 in"
  $block.CellsU("Char.Size").FormulaU = "9 pt"
  $block.CellsU("Char.Style").FormulaU = "1"
  $block.CellsU("Char.Color").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $block.CellsU("Para.HorzAlign").FormulaU = "1"
  $block.CellsU("VerticalAlign").FormulaU = "1"
  $subtitle = Get-PlanString $Spec.subtitle
  $block.Text = if (-not [string]::IsNullOrWhiteSpace($subtitle)) { "$label`n$subtitle" } else { $label }
  Set-NativeShapeIdentity $block $Spec.id
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($block) | Out-Null
  $railW = [Math]::Max(0.035, [Math]::Min(0.07, $W * 0.07))
  $rail = $Page.DrawRectangle($X, $Y, $X + $railW, $Y + $H)
  $rail.CellsU("FillForegnd").FormulaU = Get-RgbFormula (Get-SemanticLineColor $Spec)
  $rail.CellsU("LinePattern").FormulaU = "0"
  Set-PlanData $rail $Spec.shapeData
  $created.Add($rail) | Out-Null
  foreach ($badge in @(Draw-RepeatBadge $Page $Spec $X $Y $W $H $Scale)) { $created.Add($badge) | Out-Null }
  return $created.ToArray()
}

function Draw-Legend([object]$Page, [object]$Plan, [double]$PageWidth, [double]$Scale) {
  # The legend mirrors explicit plan semantics; labels are display text only.
  $items = New-Object 'System.Collections.Generic.List[object]'
  $seen = @{}
  foreach ($spec in @($Plan.shapes)) {
    $kind = Get-PlanString $spec.shapeKind
    if ($kind -ne "named-module") { continue }
    $label = Get-PlanString $spec.label
    if ([string]::IsNullOrWhiteSpace($label)) { continue }
    $key = $label.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $items.Add([pscustomobject]@{ label = $label; fill = (Get-SemanticColor $spec); line = (Get-SemanticLineColor $spec) }) | Out-Null
  }
  if ($items.Count -eq 0) { return @() }

  $created = New-Object 'System.Collections.Generic.List[object]'
  $box = 0.15
  $gap = 0.1
  $labelWidth = 0.6
  $totalW = ($box + $labelWidth) * $items.Count + $gap * [Math]::Max(0, $items.Count - 1)
  $startX = [double]$PageWidth - $totalW - 0.28
  $startY = 0.26
  $title = Draw-TextAnnotation $Page "Module" ($startX) ($startY + $box + 0.02) $totalW 0.16 "7 pt" ([string]$Plan.renderId) "" "legend-title"
  if ($null -ne $title) { $created.Add($title) | Out-Null }
  $cursorX = $startX
  foreach ($item in $items) {
    $swatch = $Page.DrawRectangle($cursorX, $startY, $cursorX + $box, $startY + $box)
    $swatch.CellsU("FillForegnd").FormulaU = Get-RgbFormula $item.fill
    $swatch.CellsU("FillBkgnd").FormulaU = Get-RgbFormula $item.fill
    $swatch.CellsU("LineColor").FormulaU = Get-RgbFormula $item.line
    $swatch.CellsU("LineWeight").FormulaU = "0.007 in"
    Set-ShapeData $swatch "renderId" ([string]$Plan.renderId)
    Set-ShapeData $swatch "legendLabel" ([string]$item.label)
    $created.Add($swatch) | Out-Null
    $text = Draw-TextAnnotation $Page ([string]$item.label) ($cursorX + $box + 0.04) ($startY - 0.005) $labelWidth $box "7 pt" ([string]$Plan.renderId) "" "legend-label"
    if ($null -ne $text) { $created.Add($text) | Out-Null }
    $cursorX += $box + $labelWidth + $gap
  }
  return $created.ToArray()
}

function Draw-PublicationPolygon([object]$Page, [object[]]$Points, [object]$Spec, [double]$Scale, [string]$Fill = "", [double]$Opacity = 0.72) {
  if ($null -eq $Points -or @($Points).Count -lt 3) { return $null }
  $coordinates = New-Object 'System.Collections.Generic.List[double]'
  foreach ($point in @($Points)) {
    $coordinates.Add([double]$point[0] * $Scale) | Out-Null
    $coordinates.Add([double]$point[1] * $Scale) | Out-Null
  }
  $coordinates.Add([double]$Points[0][0] * $Scale) | Out-Null
  $coordinates.Add([double]$Points[0][1] * $Scale) | Out-Null
  $shape = $Page.DrawPolyline($coordinates.ToArray(), 0)
  $lineColor = Get-PlanString $Spec.geometryData.style.stroke
  if ([string]::IsNullOrWhiteSpace($lineColor)) { $lineColor = "#445668" }
  $fillColor = if ([string]::IsNullOrWhiteSpace($Fill)) { Get-PlanString $Spec.geometryData.style.fill } else { $Fill }
  if ([string]::IsNullOrWhiteSpace($fillColor)) { $fillColor = "#F5E1D2" }
  $shape.CellsU("FillForegnd").FormulaU = Get-RgbFormula $fillColor
  $shape.CellsU("FillBkgnd").FormulaU = Get-RgbFormula $fillColor
  $shape.CellsU("LineColor").FormulaU = Get-RgbFormula $lineColor
  $shape.CellsU("LineWeight").FormulaU = "0.006 in"
  $transparency = (100 * (1 - $Opacity)).ToString("0.###", [Globalization.CultureInfo]::InvariantCulture) + "%"
  $shape.CellsU("FillForegndTrans").FormulaU = $transparency
  $shape.CellsU("FillBkgndTrans").FormulaU = $transparency
  Set-PlanData $shape $Spec.shapeData
  return $shape
}

function Draw-PublicationTensorPrimitive([object]$Page, [object]$Spec, [double]$Scale, [bool]$Banded) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $faces = $Spec.geometryData.faces
  $opacity = 0.72
  try { $opacity = [double]$Spec.geometryData.style.opacity } catch {}
  $side = Draw-PublicationPolygon $Page $faces.side $Spec $Scale "" $opacity
  if ($null -ne $side) { $created.Add($side) | Out-Null }
  $top = Draw-PublicationPolygon $Page $faces.top $Spec $Scale "" $opacity
  if ($null -ne $top) { $created.Add($top) | Out-Null }
  $front = Draw-PublicationPolygon $Page $faces.front $Spec $Scale "" $opacity
  if ($null -ne $front) {
    Set-NativeShapeIdentity $front $Spec.id
    $created.Add($front) | Out-Null
  }
  if ($Banded -and $null -ne $Spec.geometryData.band) {
    $bandFill = Get-PlanString $Spec.geometryData.style.bandFill
    $bandOpacity = 0.78
    try { $bandOpacity = [double]$Spec.geometryData.style.bandOpacity } catch {}
    $band = Draw-PublicationPolygon $Page $Spec.geometryData.band.front $Spec $Scale $bandFill $bandOpacity
    if ($null -ne $band) { $created.Add($band) | Out-Null }
    $bandTop = Draw-PublicationPolygon $Page $Spec.geometryData.band.top $Spec $Scale $bandFill $bandOpacity
    if ($null -ne $bandTop) { $created.Add($bandTop) | Out-Null }
  }
  foreach ($labelShape in @(Draw-PublicationDimensionLabels $Page $Spec $Scale)) {
    if ($null -ne $labelShape) { $created.Add($labelShape) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-PublicationDimensionLabels([object]$Page, [object]$Spec, [double]$Scale) {
  $labels = $Spec.geometryData.labels
  if ($null -eq $labels) { return @() }
  $created = New-Object 'System.Collections.Generic.List[object]'
  $x = [double]$Spec.x * $Scale
  $y = [double]$Spec.y * $Scale
  $w = [double]$Spec.w * $Scale
  $h = [double]$Spec.h * $Scale
  $depth = 0.0
  try { $depth = [double]$Spec.geometryData.geometry.depth * $Scale } catch {}
  $renderId = Get-PlanString $Spec.shapeData.renderId
  $sourceId = Get-PlanString $Spec.shapeData.sourceNodeId
  if (-not [string]::IsNullOrWhiteSpace((Get-PlanString $labels.x))) {
    $shape = Draw-TextAnnotation $Page (Get-PlanString $labels.x) ($x + ($w / 2) - 0.35) ($y + $h + 0.10) 0.7 0.18 "6 pt" $renderId $sourceId "dimension-label"
    if ($null -ne $shape) { $created.Add($shape) | Out-Null }
  }
  if (-not [string]::IsNullOrWhiteSpace((Get-PlanString $labels.y))) {
    $shape = Draw-TextAnnotation $Page (Get-PlanString $labels.y) ($x + 0.04) ($y + ($h / 2) - 0.09) 0.55 0.18 "6 pt" $renderId $sourceId "dimension-label"
    if ($null -ne $shape) { $created.Add($shape) | Out-Null }
  }
  if (-not [string]::IsNullOrWhiteSpace((Get-PlanString $labels.z))) {
    $shape = Draw-TextAnnotation $Page (Get-PlanString $labels.z) ($x + $w + $depth * 0.58) ($y + $h - 0.32) 0.6 0.18 "6 pt" $renderId $sourceId "dimension-label"
    if ($null -ne $shape) { $created.Add($shape) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-PublicationDenseLayer([object]$Page, [object]$Spec, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $lineColor = Get-PlanString $Spec.geometryData.style.stroke
  if ([string]::IsNullOrWhiteSpace($lineColor)) { $lineColor = "#5F6F7F" }
  $renderId = Get-PlanString $Spec.shapeData.renderId
  $sourceId = Get-PlanString $Spec.shapeData.sourceNodeId
  foreach ($link in @($Spec.geometryData.links)) {
    $points = @($link.points)
    if ($points.Count -lt 2) { continue }
    $line = $Page.DrawLine(
      ([double]$points[0][0] * $Scale),
      ([double]$points[0][1] * $Scale),
      ([double]$points[1][0] * $Scale),
      ([double]$points[1][1] * $Scale)
    )
    $line.CellsU("LineColor").FormulaU = Get-RgbFormula "#A8B1BB"
    $line.CellsU("LineWeight").FormulaU = "0.004 in"
    $line.CellsU("LineColorTrans").FormulaU = "28%"
    Set-PlanData $line $Spec.shapeData
    $created.Add($line) | Out-Null
  }
  $fill = Get-PlanString $Spec.geometryData.style.fill
  if ([string]::IsNullOrWhiteSpace($fill)) { $fill = "#FBFCFD" }
  foreach ($node in @($Spec.geometryData.nodes)) {
    $r = [double]$node.r * $Scale
    $cx = [double]$node.x * $Scale
    $cy = [double]$node.y * $Scale
    $circle = $Page.DrawOval($cx - $r, $cy - $r, $cx + $r, $cy + $r)
    $circle.CellsU("FillForegnd").FormulaU = Get-RgbFormula $fill
    $circle.CellsU("FillBkgnd").FormulaU = Get-RgbFormula $fill
    $circle.CellsU("LineColor").FormulaU = Get-RgbFormula "#415164"
    $circle.CellsU("LineWeight").FormulaU = "0.007 in"
    $circle.Text = ""
    Set-PlanData $circle $Spec.shapeData
    $created.Add($circle) | Out-Null
  }
  foreach ($label in @($Spec.geometryData.layerLabels)) {
    $text = Get-PlanString $label.text
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    $labelShape = Draw-TextAnnotation $Page $text (([double]$label.x * $Scale) - 0.18) (([double]$label.y * $Scale) + 0.04) 0.36 0.16 "6 pt" $renderId $sourceId "dimension-label"
    if ($null -ne $labelShape) { $created.Add($labelShape) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-PublicationLayerStack([object]$Page, [object]$Spec, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $bounds = $Spec.geometryData.bounds
  if ($null -ne $bounds) {
    $frame = $Page.DrawRectangle(
      ([double]$bounds.x * $Scale),
      ([double]$bounds.y * $Scale),
      (([double]$bounds.x + [double]$bounds.w) * $Scale),
      (([double]$bounds.y + [double]$bounds.h) * $Scale)
    )
    $frame.CellsU("FillPattern").FormulaU = "0"
    $frame.CellsU("LinePattern").FormulaU = "0"
    Set-NativeShapeIdentity $frame $Spec.id
    Set-PlanData $frame $Spec.shapeData
    $created.Add($frame) | Out-Null
  }
  if ($null -ne $Spec.geometryData.backing) {
    $backingSpec = [pscustomobject]@{ id = $Spec.geometryData.backing.id; shapeData = $Spec.shapeData; geometryData = $Spec.geometryData.backing }
    foreach ($shape in @(Draw-PublicationTensorPrimitive $Page $backingSpec $Scale $false)) {
      $created.Add($shape) | Out-Null
    }
  }
  foreach ($cell in @($Spec.geometryData.cells)) {
    $cellSpec = [pscustomobject]@{ id = $cell.id; shapeData = $Spec.shapeData; geometryData = $cell }
    $banded = (Get-PlanString $cell.kind) -eq "right-banded-tensor"
    foreach ($shape in @(Draw-PublicationTensorPrimitive $Page $cellSpec $Scale $banded)) {
      $created.Add($shape) | Out-Null
    }
  }
  return $created.ToArray()
}

function Draw-PublicationGroupBox([object]$Page, [object]$Spec, [double]$Scale) {
  $bounds = $Spec.geometryData.bounds
  $x = [double]$bounds.x * $Scale
  $y = [double]$bounds.y * $Scale
  $w = [double]$bounds.w * $Scale
  $h = [double]$bounds.h * $Scale
  $shape = $Page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = ""
  $shape.CellsU("FillForegnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $shape.CellsU("FillBkgnd").FormulaU = Get-RgbFormula "#F7FAFC"
  $shape.CellsU("FillForegndTrans").FormulaU = "78%"
  $shape.CellsU("FillBkgndTrans").FormulaU = "78%"
  $shape.CellsU("LineColor").FormulaU = Get-RgbFormula "#7A8EA3"
  $shape.CellsU("LineWeight").FormulaU = "0.008 in"
  $shape.CellsU("LinePattern").FormulaU = "2"
  Set-PlanData $shape $Spec.shapeData
  $created = New-Object 'System.Collections.Generic.List[object]'
  $created.Add($shape) | Out-Null
  $label = Get-PlanString $Spec.geometryData.label
  if (-not [string]::IsNullOrWhiteSpace($label)) {
    $renderId = Get-PlanString $Spec.shapeData.renderId
    $sourceId = Get-PlanString $Spec.shapeData.sourceNodeId
    $labelShape = Draw-TextAnnotation $Page $label ($x + 0.10) ($y + 0.07) ($w - 0.20) 0.22 "7 pt" $renderId $sourceId "group-label"
    if ($null -ne $labelShape) { $created.Add($labelShape) | Out-Null }
  }
  return $created.ToArray()
}

function Draw-PublicationLabel([object]$Page, [object]$Spec, [double]$Scale) {
  $x = [double]$Spec.x * $Scale
  $y = [double]$Spec.y * $Scale
  $w = [double]$Spec.w * $Scale
  $h = [double]$Spec.h * $Scale
  $text = Get-PlanString $Spec.geometryData.text
  if ([string]::IsNullOrWhiteSpace($text)) { return @() }
  $shape = $Page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  $shape.CellsU("FillPattern").FormulaU = "0"
  $shape.CellsU("LinePattern").FormulaU = "0"
  $shape.CellsU("Char.Size").FormulaU = "6.5 pt"
  $shape.CellsU("Char.Color").FormulaU = "RGB(35,45,55)"
  try { $shape.CellsU("Para.Wrap").FormulaU = "FALSE" } catch {}
  $shape.CellsU("Para.HorzAlign").FormulaU = "1"
  $shape.CellsU("VerticalAlign").FormulaU = "1"
  Set-PlanData $shape $Spec.shapeData
  return @($shape)
}

function Draw-ScenePrimitive([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $form = (Get-PlanString $Spec.sceneForm).ToLowerInvariant()
  if ($form -eq "plane") {
    $tags = (Get-PlanString $Spec.shapeData.semanticTags).ToLowerInvariant()
    if ($tags -match "input" -and $tags -match "spatial") { return @(Draw-ImageInput $Page $Spec $X $Y $W $H $Scale) }
    return @(Draw-FeaturePlane $Page $Spec $X $Y $W $H $Scale)
  }
  if ($form -eq "volume") { return @(Draw-FeatureVolume $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "stack") { return @(Draw-FeatureMapStack $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "band") { return @(Draw-PublicationBlock $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "wedge") { return @(Draw-DownsampleFrustum $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "glyph") {
    $tags = (Get-PlanString $Spec.shapeData.semanticTags).ToLowerInvariant()
    if ($tags -match "merge") { return @(Draw-MergeAddShape $Page $Spec $X $Y $W $H $Scale) }
    return @(Draw-OperatorGlyph $Page $Spec $X $Y $W $H $Scale)
  }
  if ($form -eq "cell") { return @(Draw-RecurrentInstance $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "strip") { return @(Draw-SequenceInput $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "callout") { return @(Draw-UnresolvedModule $Page $Spec $X $Y $W $H $Scale) }
  if ($form -eq "text") { return @(Draw-AnnotationShape $Page $Spec $X $Y $W $H $Scale) }
  throw "Unsupported Scene primitive form: $form"
}

function Draw-PlanShape([object]$Page, [object]$Spec, [double]$Scale) {
  $x = [double]([double]$Spec.x * [double]$Scale)
  $y = [double]([double]$Spec.y * [double]$Scale)
  $w = [double]([double]$Spec.w * [double]$Scale)
  $h = [double]([double]$Spec.h * [double]$Scale)
  $sceneForm = Get-PlanString $Spec.sceneForm
  if (-not [string]::IsNullOrWhiteSpace($sceneForm)) { return @(Draw-ScenePrimitive $Page $Spec $x $y $w $h $Scale) }
  $kind = Get-PlanString $Spec.shapeKind
  if ($kind -eq "publication-tensor-box") { return @(Draw-PublicationTensorPrimitive $Page $Spec $Scale $false) }
  if ($kind -eq "publication-right-banded-tensor") { return @(Draw-PublicationTensorPrimitive $Page $Spec $Scale $true) }
  if ($kind -eq "publication-dense-layer") { return @(Draw-PublicationDenseLayer $Page $Spec $Scale) }
  if ($kind -eq "publication-layer-stack") { return @(Draw-PublicationLayerStack $Page $Spec $Scale) }
  if ($kind -eq "publication-group-box") { return @(Draw-PublicationGroupBox $Page $Spec $Scale) }
  if ($kind -eq "publication-label") { return @(Draw-PublicationLabel $Page $Spec $Scale) }
  if ($kind -eq "publication-block") { return @(Draw-PublicationBlock $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "named-module") { return @(Draw-NamedModule $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "classifier-prism") { return @(Draw-NeuronColumn $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "softmax-prism") { return @(Draw-OutputDistribution $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "pool-prism") {
    return @(Draw-DownsampleFrustum $Page $Spec $x $y $w $h $Scale)
  }
  if ($kind -eq "upsample-box" -or (Get-PlanString $Spec.visualRole) -eq "upsample") {
    return @(Draw-DownsampleFrustum $Page $Spec $x $y $w $h $Scale)
  }
  $visualRole = Get-PlanString $Spec.visualRole
  if ($visualRole -eq "decision") { return @(Draw-DecisionShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "merge-add") { return @(Draw-MergeAddShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "merge-concat") { return @(Draw-MergeConcatShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "split") { return @(Draw-SplitShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "junction") { return @(Draw-JunctionShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "repeat-marker") { return @(Draw-RepeatMarkerShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "annotation") { return @(Draw-AnnotationShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "inner-attention") { return @(Draw-AttentionModule $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "inner-norm") { return @(Draw-NormModule $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "inner-operator" -or $visualRole -eq "inner-capsule") { return @(Draw-InnerOperatorShape $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "image-input") { return @(Draw-ImageInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "sequence-input") { return @(Draw-SequenceInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "state-input") { return @(Draw-StateInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "vector-input") { return @(Draw-VectorInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "volume-input") { return @(Draw-VolumeInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "unknown-input") { return @(Draw-UnknownInput $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "vectorize" -or $kind -eq "flatten-ribbon") { return @(Draw-FlattenRibbon $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "input-tensor") { return @(Draw-InputTensor $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "legacy-publication-tensor") { return @(Draw-FeatureMapStack $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "feature-map-stage" -or $kind -match "volume|tensor") { return @(Draw-FeaturePlane $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "recurrent-instance" -or $kind -eq "recurrent-instance") { return @(Draw-RecurrentInstance $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "compound-module" -or $kind -eq "compound") {
    $pattern = Get-PlanString $Spec.shapeData.modulePattern
    if ([string]::IsNullOrWhiteSpace($pattern)) { $pattern = "opaque" }
    return @(Draw-StructuredModule $Page $Spec $x $y $w $h $Scale $pattern)
  }
  if ($visualRole -eq "unresolved-module") { return @(Draw-UnresolvedModule $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "operator-symbol") {
    $shape = $Page.DrawOval($x, $y, $x + $w, $y + $h)
    Set-ShapeStyle $shape $Spec $Scale
    return $shape
  }
  return @(Draw-OperatorGlyph $Page $Spec $x $y $w $h $Scale)
}

function Draw-JunctionDot([object]$Page, [object]$Spec, [double]$Scale) {
  $role = Get-PlanString $Spec.junctionRole
  if ([string]::IsNullOrWhiteSpace($role)) { return @() }
  $x = [double]([double]$Spec.x * [double]$Scale)
  $y = [double]([double]$Spec.y * [double]$Scale)
  $w = [double]([double]$Spec.w * [double]$Scale)
  $h = [double]([double]$Spec.h * [double]$Scale)
  $cy = $y + $h / 2
  $r = [double](4.0 * $Scale)
  $dots = @()
  if ($role -match "merge") {
    $leftDot = $Page.DrawOval($x - $r, $cy - $r, $x + $r, $cy + $r)
    $leftDot.CellsU("FillForegnd").FormulaU = "RGB(36,130,112)"
    $leftDot.CellsU("LinePattern").FormulaU = "0"
    $dots += $leftDot
  }
  if ($role -match "fork") {
    $rightDot = $Page.DrawOval(($x + $w) - $r, $cy - $r, ($x + $w) + $r, $cy + $r)
    $rightDot.CellsU("FillForegnd").FormulaU = "RGB(36,130,112)"
    $rightDot.CellsU("LinePattern").FormulaU = "0"
    $dots += $rightDot
  }
  return $dots
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
    $routeClass = (Get-PlanString $Spec.routeClass).ToLowerInvariant()
    $line.CellsU("LineColor").FormulaU = if ($Spec.recurrentRailKind -eq "feedback" -or $routeClass -eq "feedback") { "RGB(196,124,48)" } elseif ($Spec.recurrentRailKind -eq "update") { "RGB(36,140,106)" } elseif ($Spec.recurrentRailKind -eq "carry") { "RGB(70,126,166)" } elseif ($routeClass -match "conditional") { "RGB(126,92,164)" } elseif ($routeClass -match "skip|residual|branch" -or $Spec.type -match "skip|residual") { "RGB(49,132,112)" } elseif ($routeClass -match "cross-scale|scale-transfer|merge") { "RGB(82,112,158)" } else { "RGB(63,84,112)" }
    $line.CellsU("LineWeight").FormulaU = "0.009 in"
    if ($routeClass -match "skip|residual|branch|feedback|conditional|cross-scale") { $line.CellsU("LinePattern").FormulaU = "2" }
    if ($index -eq $points.Count - 2) { $line.CellsU("EndArrow").FormulaU = "13" }
    $segmentRole = if ($points.Count -eq 2) { "direct" } elseif ($index -eq 0) { "begin" } elseif ($index -eq $points.Count - 2) { "end" } else { "middle" }
    if ($index -eq 0 -and -not $Spec.avoidGlue) { Glue-Endpoint $line "BeginX" $ShapeMap[[string]$Spec.sourceShapeId] $true }
    if ($index -eq $points.Count - 2 -and -not $Spec.avoidGlue) { Glue-Endpoint $line "EndX" $ShapeMap[[string]$Spec.targetShapeId] $false }
    Set-PlanData $line ([pscustomobject]@{
      renderId = $Spec.renderId
      edgeId = $Spec.id
      sourceEdgeId = $Spec.sourceEdgeId
      sourceNodeId = $Spec.sourceNodeId
      targetNodeId = $Spec.targetNodeId
      visualRole = "connector"
      edgeType = $Spec.type
      routeClass = $routeClass
      sourceContainerId = $Spec.sourceContainerId
      targetContainerId = $Spec.targetContainerId
      sourceLaneId = $Spec.sourceLaneId
      targetLaneId = $Spec.targetLaneId
      recurrentRailKind = $Spec.recurrentRailKind
      sourceShapeId = $Spec.sourceShapeId
      targetShapeId = $Spec.targetShapeId
      sourceEndpointId = if ($null -ne $Spec.sourceEndpointIds) { Get-PlanString $Spec.sourceEndpointIds.source } else { "" }
      targetEndpointId = if ($null -ne $Spec.sourceEndpointIds) { Get-PlanString $Spec.sourceEndpointIds.target } else { "" }
      segmentRole = $segmentRole
      evidenceCount = $Spec.evidenceCount
      planVersion = "visio-native-bridge/v1"
    })
    $created.Add($line) | Out-Null
  }
  return $created.ToArray()
}

function Invoke-VisioBridgePlan([string]$EncodedPlanBase64) {
$PlanBase64 = $EncodedPlanBase64
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PlanBase64))
$plan = $json | ConvertFrom-Json
if ($plan.createDocument -ne $false) { throw "The Visio bridge only accepts existing documents." }
if ([string]::IsNullOrWhiteSpace([string]$plan.documentPath)) { throw "documentPath is required." }

$visio = if ($WorkerMode) { $script:SynapsePersistentVisio } else { $null }
$attachedViaMoniker = $false
if ([string]$plan.openMode -eq "fresh") {
  $visio = New-Object -ComObject Visio.Application
  $doc = $visio.Documents.Open([string]$plan.documentPath)
} else {
  try {
    $doc = [Runtime.InteropServices.Marshal]::BindToMoniker([string]$plan.documentPath)
    $attachedViaMoniker = $true
  } catch {
    if ($null -eq $visio) { $visio = New-Object -ComObject Visio.Application }
    try {
      $doc = $visio.Documents.Open([string]$plan.documentPath)
    } catch {
      try { $visio.Quit() } catch {}
      throw "The existing Visio document could not be opened in an automation instance: $($_.Exception.Message)"
    }
  }
}

$hiddenAttachedDocument = $false
if ($attachedViaMoniker) {
  try {
    $hiddenAttachedDocument = (-not [bool]$doc.Application.Visible) -and ([int]$doc.Application.Windows.Count -eq 0)
  } catch { $hiddenAttachedDocument = $true }
  if ($hiddenAttachedDocument) {
    try {
      if (-not [bool]$doc.Saved) { throw "The hidden attached Visio document has unsaved changes." }
    } catch { throw "The bridge will not close an unsaved hidden Visio attachment: $($_.Exception.Message)" }
    $attachedApplication = $null
    try { $attachedApplication = $doc.Application } catch {}
    try { $doc.Close() } catch { throw "The hidden Visio moniker attachment could not be released: $($_.Exception.Message)" }
    try {
      if ($null -ne $attachedApplication -and $attachedApplication.Documents.Count -eq 0) { $attachedApplication.Quit() }
    } catch {}
    if ($null -eq $visio) { $visio = New-Object -ComObject Visio.Application }
    try {
      $doc = $visio.Documents.Open([string]$plan.documentPath)
    } catch {
      try { $visio.Quit() } catch {}
      throw "The existing Visio document could not be reopened as a writable document after releasing the hidden moniker attachment: $($_.Exception.Message)"
    }
  }
}

if ([bool]$doc.ReadOnly) {
  $hiddenSavedDocument = $false
  try {
    $hiddenSavedDocument = (-not [bool]$doc.Application.Visible) -and [bool]$doc.Saved
  } catch {}
  if ($hiddenSavedDocument) {
    for ($attempt = 0; $attempt -lt 3 -and [bool]$doc.ReadOnly; $attempt++) {
      $attachedApplication = $null
      try { $attachedApplication = $doc.Application } catch {}
      try { $doc.Close() } catch { throw "The existing Visio document is read-only and its hidden saved instance could not be released: $($_.Exception.Message)" }
      try {
        if ($null -ne $attachedApplication -and $attachedApplication.Documents.Count -eq 0) { $attachedApplication.Quit() }
      } catch {}
      $doc = $null
      try { $doc = [Runtime.InteropServices.Marshal]::BindToMoniker([string]$plan.documentPath) } catch {}
      if ($null -eq $doc) { break }
      $nextHiddenSaved = $false
      try { $nextHiddenSaved = [bool]$doc.ReadOnly -and (-not [bool]$doc.Application.Visible) -and [bool]$doc.Saved } catch {}
      if (-not $nextHiddenSaved) { break }
    }
    if ($null -eq $doc -or [bool]$doc.ReadOnly) {
      if ($null -eq $visio) { $visio = New-Object -ComObject Visio.Application }
      try {
        $doc = $visio.Documents.Open([string]$plan.documentPath)
      } catch {
        try { $visio.Quit() } catch {}
        throw "The existing Visio document is locked by another instance after releasing hidden saved agent instances: $($_.Exception.Message)"
      }
    }
  }
  if ([bool]$doc.ReadOnly) {
    throw "The existing Visio document is read-only. The bridge will not modify or replace a visible/user-owned document."
  }
}
try { $page = $doc.Pages.ItemU([string]$plan.pageName) } catch { throw "Visio page not found: $($plan.pageName)" }
$agentCleanup = [pscustomobject]@{ matched = 0; removed = 0; failed = 0 }
if ((Get-PlanString $plan.replaceScope) -match "agent-owned") {
  $agentCleanup = Remove-StaleAgentShapes $page
} else {
  Remove-OwnedShapes $page ([string]$plan.renderId)
}
$legacyCleanup = [pscustomobject]@{ matched = 0; removed = 0; failed = 0 }
if (-not [string]::IsNullOrWhiteSpace([string]$plan.replaceLegacyPrefix)) {
  $legacyCleanup = Remove-LegacyShapesByPrefix $page ([string]$plan.replaceLegacyPrefix)
}
$pageSize = Set-PageLayout $page $plan ([double]$plan.unitScale)
Draw-FigureHeader $page $plan ([double]$pageSize.width) ([double]$pageSize.height) ([double]$plan.unitScale)

[int]$shapeCount = 0
[int]$connectorCount = 0
$shapeMap = @{}
# Group containers (Backbone/Neck/Head/Stage) are drawn first, underneath the nodes.
foreach ($group in @($plan.groups)) {
  $groupFrames = @(Draw-GroupContainer $page $group ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$groupFrames.Count
}
foreach ($spec in @($plan.shapes)) {
  $drawn = @(Draw-PlanShape $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$drawn.Count
  if ($drawn.Count -gt 0) { $shapeMap[$spec.id] = Get-NativeShapeForPlan $drawn ([string]$spec.id) }
  $junctionDots = @(Draw-JunctionDot $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$junctionDots.Count
  $labels = @(Draw-PlanLabel $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$labels.Count
}
foreach ($spec in @($plan.connectors)) {
  $lines = Draw-PlanConnector $page $spec ([double]$plan.unitScale) $shapeMap
  if ($null -ne $lines) { $connectorCount = [int]$connectorCount + [int]@($lines).Count }
}
$legendShapes = @()
$shapeCount = [int]$shapeCount + [int]$legendShapes.Count

$doc.Save() | Out-Null
$previewExport = [pscustomobject]@{ requested = $false; exported = $false; path = "" }
if (-not [string]::IsNullOrWhiteSpace([string]$plan.previewPath)) {
  $previewExport = [pscustomobject]@{ requested = $true; exported = $false; path = [string]$plan.previewPath }
  try {
    $page.Export([string]$plan.previewPath)
    $previewExport.exported = $true
  } catch {
    throw "The existing Visio page was rendered, but preview export failed: $($_.Exception.Message)"
  }
}

$readbackSession = "current-document"
$reopened = $false
if ([string]$plan.readbackMode -eq "reopen") {
  # Opt-in persisted-document acceptance: release the writing session and
  # reopen the saved VSDX in a separate COM application before readback.
  $reopenedVisio = New-Object -ComObject Visio.Application
  try {
    $doc.Close()
    $doc = $reopenedVisio.Documents.Open([string]$plan.documentPath)
    $page = $doc.Pages.ItemU([string]$plan.pageName)
  } catch {
    try { $reopenedVisio.Quit() } catch {}
    throw "The Visio document was saved but could not be reopened for independent readback: $($_.Exception.Message)"
  }
  $readbackSession = "reopened-document"
  $reopened = $true
}
$doc.Application.Visible = $true
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
$readbackConnectorEndpoints = @{}
[System.Collections.Generic.List[string]]$gluedBeginEdgeIds = New-Object 'System.Collections.Generic.List[string]'
[System.Collections.Generic.List[string]]$gluedEndEdgeIds = New-Object 'System.Collections.Generic.List[string]'
$readbackConnectorCount = 0
$readbackShapes = $page.Shapes
for ($index = 1; $index -le [int]$readbackShapes.Count; $index++) {
  $shape = $null
  try { $shape = $readbackShapes.Item($index) } catch { continue }
  if ($null -eq $shape) { continue }
  try {
    if ([int]$shape.CellExistsU("Prop.renderId", 0) -eq 0) { continue }
    if ($shape.CellsU("Prop.renderId").ResultStr("") -ne [string]$plan.renderId) { continue }
    if ([int]$shape.CellExistsU("Prop.visualRole", 0) -ne 0 -and $shape.CellsU("Prop.visualRole").ResultStr("") -eq "connector") {
      $readbackConnectorCount++
      if ([int]$shape.CellExistsU("Prop.edgeId", 0) -ne 0) {
        $edgeId = $shape.CellsU("Prop.edgeId").ResultStr("")
        if ($edgeId) {
          $readbackEdgeIds.Add($edgeId) | Out-Null
          $sourceEndpointId = ""
          $targetEndpointId = ""
          try { if ([int]$shape.CellExistsU("Prop.sourceEndpointId", 0) -ne 0) { $sourceEndpointId = $shape.CellsU("Prop.sourceEndpointId").ResultStr("") } } catch {}
          try { if ([int]$shape.CellExistsU("Prop.targetEndpointId", 0) -ne 0) { $targetEndpointId = $shape.CellsU("Prop.targetEndpointId").ResultStr("") } } catch {}
          $sourceEdgeId = $edgeId
          try { if ([int]$shape.CellExistsU("Prop.sourceEdgeId", 0) -ne 0) { $sourceEdgeId = $shape.CellsU("Prop.sourceEdgeId").ResultStr("") } } catch {}
          $readbackConnectorEndpoints[$sourceEdgeId] = [pscustomobject]@{
            sourceEdgeId = $sourceEdgeId
            sourceEndpointId = $sourceEndpointId
            targetEndpointId = $targetEndpointId
          }
          $segmentRole = ""
          try { if ([int]$shape.CellExistsU("Prop.segmentRole", 0) -ne 0) { $segmentRole = $shape.CellsU("Prop.segmentRole").ResultStr("") } } catch {}
          $connectCount = 0
          try { $connectCount = [int]$shape.Connects.Count } catch {}
          if ($connectCount -gt 0 -and ($segmentRole -eq "begin" -or $segmentRole -eq "direct")) { $gluedBeginEdgeIds.Add($edgeId) | Out-Null }
          if ($connectCount -gt 0 -and ($segmentRole -eq "end" -or $segmentRole -eq "direct")) { $gluedEndEdgeIds.Add($edgeId) | Out-Null }
        }
      }
    }
    if ([int]$shape.CellExistsU("Prop.sourceNodeIds", 0) -ne 0) {
      $sourceNodeIdsJson = $shape.CellsU("Prop.sourceNodeIds").ResultStr("")
      if ($sourceNodeIdsJson) {
        foreach ($sourceNodeId in @($sourceNodeIdsJson | ConvertFrom-Json)) {
          if (-not [string]::IsNullOrWhiteSpace([string]$sourceNodeId)) {
            $readbackSourceNodeIds.Add([string]$sourceNodeId) | Out-Null
          }
        }
      }
    }
    if ([int]$shape.CellExistsU("Prop.sourceNodeId", 0) -ne 0) {
      $sourceNodeId = $shape.CellsU("Prop.sourceNodeId").ResultStr("")
      if ($sourceNodeId) { $readbackSourceNodeIds.Add($sourceNodeId) | Out-Null }
    }
  } catch {}
}

if ($WorkerMode) {
  try { $script:SynapsePersistentVisio = $doc.Application } catch {}
}
$totalShapes = 0
try { $totalShapes = [int]$page.Shapes.Count } catch {}
[pscustomobject]@{
  status = "rendered"
  documentPath = $doc.FullName
  pageName = $page.NameU
  documentReadOnly = [bool]$doc.ReadOnly
  renderId = [string]$plan.renderId
  createdShapes = $shapeCount
  createdConnectorSegments = $connectorCount
  totalShapes = $totalShapes
  saved = $true
  previewExport = $previewExport
  agentCleanup = $agentCleanup
  legacyCleanup = $legacyCleanup
  windowActivated = $windowActivated
  reopened = $reopened
  readbackSession = $readbackSession
  readback = [pscustomobject]@{
    renderId = [string]$plan.renderId
    sourceNodeIds = @($readbackSourceNodeIds | Sort-Object -Unique)
    edgeIds = @($readbackEdgeIds | Sort-Object -Unique)
    connectorEndpoints = $readbackConnectorEndpoints
    gluedBeginEdgeIds = @($gluedBeginEdgeIds | Sort-Object -Unique)
    gluedEndEdgeIds = @($gluedEndEdgeIds | Sort-Object -Unique)
    connectorCount = $readbackConnectorCount
    shapeCount = @($readbackSourceNodeIds | Sort-Object -Unique).Count
  }
} | ConvertTo-Json -Compress -Depth 10
}

if ($WorkerMode) {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
      Write-Output (Invoke-VisioBridgePlan $line)
      [Console]::Out.Flush()
    } catch {
      $detail = $_.Exception.GetType().FullName + " | " + $_.Exception.Message
      if ($_.Exception.InnerException) { $detail += " | inner: " + $_.Exception.InnerException.Message }
      Write-Output ([ordered]@{ status = "error"; message = ($detail -replace '[\r\n]', ' ') } | ConvertTo-Json -Compress)
      [Console]::Out.Flush()
    }
  }
  try {
    if ($null -ne $script:SynapsePersistentVisio) {
      $script:SynapsePersistentVisio.Quit()
      $script:SynapsePersistentVisio = $null
    }
  } catch {}
  exit 0
}

Write-Output (Invoke-VisioBridgePlan $PlanBase64)
