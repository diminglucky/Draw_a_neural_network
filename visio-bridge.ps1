param(
  [Parameter(Mandatory = $true)]
  [string]$PlanBase64
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
  $fallback = Get-PlanString $Spec.fill
  $base = switch ($profile) {
    "feature-map" { "#FFC47A"; break }
    "feature-map-band" { "#E65034"; break }
    "input-tensor" { "#FFE6A6"; break }
    "pool" { "#E65034"; break }
    "vectorize" { "#7A238C"; break }
    "neuron" { "#9563C8"; break }
    "output" { "#7A238C"; break }
    "merge" { "#F4D7A8"; break }
    "attention" { "#E8DDF5"; break }
    "token" { "#E2EEF8"; break }
    "compound" { "#E7EEF5"; break }
    "unresolved" { "#F5F0E7"; break }
    default { $fallback }
  }
  if ([string]::IsNullOrWhiteSpace($base)) { $base = "#E7EEF5" }
  switch ($FaceRole.ToLowerInvariant()) {
    "top" {
      if ($profile -eq "feature-map") { return "#FFE7BF" }
      if ($profile -eq "feature-map-band" -or $profile -eq "pool") { return "#F5815A" }
      if ($profile -eq "input-tensor") { return "#FFF3D0" }
      if ($profile -eq "neuron") { return "#B88AE0" }
      if ($profile -eq "vectorize" -or $profile -eq "output") { return "#A854B9" }
      return $base
    }
    "side" {
      if ($profile -eq "feature-map") { return "#BC5F32" }
      if ($profile -eq "feature-map-band" -or $profile -eq "pool") { return "#9E271A" }
      if ($profile -eq "input-tensor") { return "#D89D43" }
      if ($profile -eq "neuron") { return "#70459B" }
      if ($profile -eq "vectorize" -or $profile -eq "output") { return "#4C0F5A" }
      return $base
    }
    default { return $base }
  }
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
  $line = Get-PlanString $Spec.line
  if ([string]::IsNullOrWhiteSpace($line) -or $line -eq "#263248") { $line = "#3F5D78" }
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
  $widthUnits = 2260
  $heightUnits = 1060
  try { $widthUnits = [double]$artboard.x + [double]$artboard.width } catch {}
  try { $heightUnits = [double]$artboard.y + [double]$artboard.height } catch {}
  $pageWidth = [Math]::Max(11.0, ($widthUnits * $Scale) + 1.2)
  $pageHeight = [Math]::Max(4.8, ($heightUnits * $Scale) + 0.45)
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
  for ($index = $Page.Shapes.Count; $index -ge 1; $index--) {
    $shape = $Page.Shapes.Item($index)
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

function Project-PlotNeuralNetTensorPoint([double]$X, [double]$Y, [double]$Flow, [double]$Vertical, [double]$DepthCoordinate) {
  # Exact PGF/TikZ default basis used by PlotNeuralNet:
  # x=(1,0), y=(0,1), z=(-0.385,-0.385).
  return [pscustomobject]@{
    x = $X + $Flow + ($DepthCoordinate * -0.385)
    y = $Y + $Vertical + ($DepthCoordinate * -0.385)
  }
}

function New-PlotNeuralNetFaceSpec([object]$Spec, [string]$ShapeKind, [string]$FaceRole, [double]$FillOpacity = 0.4) {
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

function Draw-PlotNeuralNetPolygon([object]$Page, [object[]]$Points, [object]$Spec, [double]$Scale) {
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

function Draw-PlotNeuralNetFarEdge([object]$Page, [object]$Start, [object]$End, [object]$Spec) {
  $edge = $Page.DrawLine([double]$Start.x, [double]$Start.y, [double]$End.x, [double]$End.y)
  $edge.CellsU("LineColor").FormulaU = Get-RgbFormula $Spec.line
  $edge.CellsU("LineWeight").FormulaU = "0.006 in"
  $edge.CellsU("LinePattern").FormulaU = "2"
  Set-PlanData $edge $Spec.shapeData
  return $edge
}

function Draw-PlotNeuralNetTensorBox([object]$Page, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$TensorDepth, [object]$Spec, [double]$Scale, [string]$FaceKind, [bool]$DrawEastFace = $false) {
  # This is a direct native-Visio transcription of PlotNeuralNet Box.sty:
  # a,b,c,d are the near tensor plane; e,f,g,h are the far tensor plane.
  # Each CNN cell receives the same geometry, rather than a copied full plane.
  $originX = $X + (0.385 * $TensorDepth / 2)
  $originY = $Y + (0.385 * $TensorDepth / 2)
  $halfDepth = $TensorDepth / 2
  $baseOpacity = 0.4
  try { if ($null -ne $Spec.fillOpacity) { $baseOpacity = [double]$Spec.fillOpacity } } catch {}
  $pointA = Project-PlotNeuralNetTensorPoint $originX $originY 0 $H $halfDepth
  $pointB = Project-PlotNeuralNetTensorPoint $originX $originY 0 0 $halfDepth
  $pointC = Project-PlotNeuralNetTensorPoint $originX $originY $W 0 $halfDepth
  $pointD = Project-PlotNeuralNetTensorPoint $originX $originY $W $H $halfDepth
  $pointE = Project-PlotNeuralNetTensorPoint $originX $originY $W $H (-$halfDepth)
  $pointF = Project-PlotNeuralNetTensorPoint $originX $originY $W 0 (-$halfDepth)
  $pointG = Project-PlotNeuralNetTensorPoint $originX $originY 0 0 (-$halfDepth)
  $pointH = Project-PlotNeuralNetTensorPoint $originX $originY 0 $H (-$halfDepth)

  $created = New-Object 'System.Collections.Generic.List[object]'
  $near = Draw-PlotNeuralNetPolygon $Page @($pointD, $pointA, $pointB, $pointC) (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-near" "front" $baseOpacity) $Scale
  $created.Add($near) | Out-Null
  $top = Draw-PlotNeuralNetPolygon $Page @($pointD, $pointA, $pointH, $pointE) (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-top" "top" $baseOpacity) $Scale
  $created.Add($top) | Out-Null
  foreach ($edge in @(
      (Draw-PlotNeuralNetFarEdge $Page $pointF $pointG (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity)),
      (Draw-PlotNeuralNetFarEdge $Page $pointB $pointG (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity)),
      (Draw-PlotNeuralNetFarEdge $Page $pointH $pointG (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-far-edge" "far-edge" $baseOpacity))
    )) {
    $created.Add($edge) | Out-Null
  }
  if ($DrawEastFace) {
    $east = Draw-PlotNeuralNetPolygon $Page @($pointD, $pointE, $pointF, $pointC) (New-PlotNeuralNetFaceSpec $Spec "$FaceKind-east" "side" $baseOpacity) $Scale
    $created.Add($east) | Out-Null
  }
  return $created.ToArray()
}

function Draw-InputTensor([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  # An input is a small stack of channel planes, not a generic volume card.
  $created = New-Object 'System.Collections.Generic.List[object]'
  $planes = @(
    [pscustomobject]@{ fill = "#DCEAF4"; line = "#6E91AA" },
    [pscustomobject]@{ fill = "#E8E7D2"; line = "#9A9567" },
    [pscustomobject]@{ fill = "#EADDDD"; line = "#A77878" }
  )
  $depth = [Math]::Max(0.05, [Math]::Min(0.13, $W * 0.18))
  for ($index = $planes.Count - 1; $index -ge 0; $index -= 1) {
    $plane = $planes[$index]
    $offset = [double]$index * [Math]::Min(0.075, $depth * 0.62)
    $planeSpec = [pscustomobject]@{
      label = if ($index -eq 0) { $Spec.label } else { "" }
      subtitle = if ($index -eq 0) { $Spec.subtitle } else { "" }
      fill = $plane.fill
      line = $plane.line
      shapeKind = "input-channel-plane"
      visualRole = "input-tensor"
      styleProfile = "operator"
      labelOutside = if ($index -eq 0) { $Spec.labelOutside } else { $false }
      shapeData = $Spec.shapeData
    }
    foreach ($face in @(Draw-PrismFaces $Page ($X - $offset) ($Y + $offset * 0.35) $W $H $depth $planeSpec $Scale "input")) {
      $created.Add($face) | Out-Null
    }
  }
  # The grid is reserved for the input image cue; intermediate feature maps
  # remain clean so that topology and scale carry the visual hierarchy.
  foreach ($grid in @(Draw-FeatureMapGrid $Page $Spec $X $Y $W $H $Scale)) {
    $created.Add($grid) | Out-Null
  }
  return $created.ToArray()
}

function Draw-FeatureMapStack([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  $repeatCount = Get-RepeatCount $Spec
  # PlotNeuralNet RightBandedBox: repeated operators are contiguous tensor
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
    }
    foreach ($shape in @(Draw-RightBandedTensorCell $Page ($X + ($cellIndex * $cellWidth)) $Y $cellWidth $H $depth $cellSpec $Scale ($cellIndex -eq ($cellCount - 1)))) {
      $created.Add($shape) | Out-Null
    }
  }
  return $created.ToArray()
}

function Draw-RightBandedTensorCell([object]$Page, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Depth, [object]$Spec, [double]$Scale, [bool]$IsLast) {
  $created = New-Object 'System.Collections.Generic.List[object]'
  foreach ($face in @(Draw-PlotNeuralNetTensorBox $Page $X $Y $W $H $Depth $Spec $Scale "feature-map-cell" $IsLast)) {
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
  $art = Project-PlotNeuralNetTensorPoint $originX $originY ($W - $bandWidth) $H $halfDepth
  $brt = Project-PlotNeuralNetTensorPoint $originX $originY ($W - $bandWidth) 0 $halfDepth
  $a = Project-PlotNeuralNetTensorPoint $originX $originY 0 $H $halfDepth
  $b = Project-PlotNeuralNetTensorPoint $originX $originY 0 0 $halfDepth
  $c = Project-PlotNeuralNetTensorPoint $originX $originY $W 0 $halfDepth
  $d = Project-PlotNeuralNetTensorPoint $originX $originY $W $H $halfDepth
  $e = Project-PlotNeuralNetTensorPoint $originX $originY $W $H (-$halfDepth)
  $f = Project-PlotNeuralNetTensorPoint $originX $originY $W 0 (-$halfDepth)
  $pointH = Project-PlotNeuralNetTensorPoint $originX $originY 0 $H (-$halfDepth)
  $hrt = Project-PlotNeuralNetTensorPoint $originX $originY ($W - $bandWidth) $H (-$halfDepth)
  $band = Draw-PlotNeuralNetPolygon $Page @($d, $art, $brt, $c) $bandSpec $Scale
  $created.Add($band) | Out-Null
  $topSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#E65034"; line = "#802218"; shapeKind = "feature-map-band-top"; visualRole = "feature-map-stage"; styleProfile = "feature-map-band"; shapeData = $Spec.shapeData; faceRole = "top"; fillOpacity = 0.6 }
  $top = Draw-PlotNeuralNetPolygon $Page @($d, $art, $hrt, $e) $topSpec $Scale
  $created.Add($top) | Out-Null
  # RightBandedBox redraws its body outlines after the translucent band.
  $outlineSpec = New-PlotNeuralNetFaceSpec $Spec "feature-map-cell-outline" "front" 0
  foreach ($outline in @(
      (Draw-PlotNeuralNetPolygon $Page @($d, $a, $b, $c) $outlineSpec $Scale),
      (Draw-PlotNeuralNetPolygon $Page @($d, $a, $pointH, $e) $outlineSpec $Scale)
    )) {
    $created.Add($outline) | Out-Null
  }
  if ($IsLast) {
    $sideSpec = [pscustomobject]@{ label = ""; subtitle = ""; fill = "#E65034"; line = "#802218"; shapeKind = "feature-map-band-side"; visualRole = "feature-map-stage"; styleProfile = "feature-map-band"; shapeData = $Spec.shapeData; faceRole = "side"; fillOpacity = 0.6 }
    $side = Draw-PlotNeuralNetPolygon $Page @($d, $e, $f, $c) $sideSpec $Scale
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
  $sourceHeight = $H
  $targetHeight = $H
  $sourceAnchor = Get-PlanString $Spec.shapeData.sourceAnchor
  $targetAnchor = Get-PlanString $Spec.shapeData.targetAnchor
  try { if ([double]$Spec.shapeData.targetHeight -gt 0) { $targetHeight = [double]$Spec.shapeData.targetHeight * $Scale } } catch {}
  # PlotNeuralNet's pooling primitive is a smaller Box representing the
  # downsampled tensor, not a source-to-target trapezium.
  $depth = $targetHeight
  $poolSpec = [pscustomobject]@{ label = $Spec.label; subtitle = $Spec.subtitle; fill = $Spec.fill; line = $Spec.line; shapeKind = "pool-box"; visualRole = "pool-downsample"; styleProfile = "pool"; labelOutside = $Spec.labelOutside; shapeData = $Spec.shapeData; fillOpacity = 0.5 }
  return @(Draw-PlotNeuralNetTensorBox $Page $X $Y $W $targetHeight $depth $poolSpec $Scale "pool-box" $true)
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
  $visualRole = Get-PlanString $Spec.visualRole
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
  $frame.CellsU("FillTransparency").FormulaU = "35"
  $frame.CellsU("LinePattern").FormulaU = "2"
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
  return @($glyph)
}

function Draw-OperatorGlyph([object]$Page, [object]$Spec, [double]$X, [double]$Y, [double]$W, [double]$H, [double]$Scale) {
  $glyph = $Page.DrawOval($X, $Y, $X + $W, $Y + $H)
  Set-ShapeStyle $glyph $Spec $Scale
  return @($glyph)
}

function Draw-PlanShape([object]$Page, [object]$Spec, [double]$Scale) {
  $x = [double]([double]$Spec.x * [double]$Scale)
  $y = [double]([double]$Spec.y * [double]$Scale)
  $w = [double]([double]$Spec.w * [double]$Scale)
  $h = [double]([double]$Spec.h * [double]$Scale)
  $kind = Get-PlanString $Spec.shapeKind
  if ($kind -eq "classifier-prism") { return @(Draw-NeuronColumn $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "softmax-prism") { return @(Draw-OutputDistribution $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "pool-prism") {
    return @(Draw-DownsampleFrustum $Page $Spec $x $y $w $h $Scale)
  }
  $visualRole = Get-PlanString $Spec.visualRole
  if ($visualRole -eq "vectorize" -or $kind -eq "flatten-ribbon") { return @(Draw-FlattenRibbon $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "input-tensor") { return @(Draw-InputTensor $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "feature-map-stage" -or $kind -match "volume|tensor") { return @(Draw-FeatureMapStack $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "compound-module" -or $kind -eq "compound") { return @(Draw-CompoundModule $Page $Spec $x $y $w $h $Scale) }
  if ($visualRole -eq "unresolved-module") { return @(Draw-UnresolvedModule $Page $Spec $x $y $w $h $Scale) }
  if ($kind -eq "operator-symbol") {
    $shape = $Page.DrawOval($x, $y, $x + $w, $y + $h)
    Set-ShapeStyle $shape $Spec $Scale
    return $shape
  }
  return @(Draw-OperatorGlyph $Page $Spec $x $y $w $h $Scale)
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
    $line.CellsU("LineColor").FormulaU = if ($Spec.type -match "skip|residual") { "RGB(36,130,112)" } else { "RGB(63,84,112)" }
    $line.CellsU("LineWeight").FormulaU = "0.009 in"
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
$attachedViaMoniker = $false
if ([string]$plan.openMode -eq "fresh") {
  $visio = New-Object -ComObject Visio.Application
  $doc = $visio.Documents.Open([string]$plan.documentPath)
} else {
  try {
    $doc = [Runtime.InteropServices.Marshal]::BindToMoniker([string]$plan.documentPath)
    $attachedViaMoniker = $true
  } catch {
    $visio = New-Object -ComObject Visio.Application
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
    $visio = New-Object -ComObject Visio.Application
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
      $visio = New-Object -ComObject Visio.Application
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
foreach ($spec in @($plan.shapes)) {
  $drawn = @(Draw-PlanShape $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$drawn.Count
  if ($drawn.Count -gt 0) { $shapeMap[$spec.id] = $drawn[0] }
  $labels = @(Draw-PlanLabel $page $spec ([double]$plan.unitScale))
  $shapeCount = [int]$shapeCount + [int]$labels.Count
}
foreach ($spec in @($plan.connectors)) {
  $lines = Draw-PlanConnector $page $spec ([double]$plan.unitScale) $shapeMap
  if ($null -ne $lines) { $connectorCount = [int]$connectorCount + [int]@($lines).Count }
}

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
  documentReadOnly = [bool]$doc.ReadOnly
  renderId = [string]$plan.renderId
  createdShapes = $shapeCount
  createdConnectorSegments = $connectorCount
  totalShapes = $page.Shapes.Count
  saved = $true
  previewExport = $previewExport
  agentCleanup = $agentCleanup
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
