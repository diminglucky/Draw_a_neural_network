param(
  [switch]$Visible,
  [switch]$Hidden,
  [switch]$AttachToRunning,
  [switch]$OpenOutput,
  [switch]$VerifyPreview,
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$root = if ($OutputRoot.Trim()) { [System.IO.Path]::GetFullPath($OutputRoot) } else { Join-Path ([System.IO.Path]::GetTempPath()) ("synapse-vgg16-" + [guid]::NewGuid().ToString("N")) }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$artifactId = "vgg16-publication-" + [guid]::NewGuid().ToString("N")
$output = Join-Path $root ($artifactId + ".vsdx")
$pngOutput = Join-Path $root ($artifactId + ".png")

Push-Location $repoRoot
try {
  if ($Visible -and $Hidden) { throw "-Visible and -Hidden cannot be used together." }
  if ($VerifyPreview -and -not $Hidden) { throw "-VerifyPreview requires -Hidden so it cannot interfere with the editable Visio document." }
  # The generator uses the deterministic VGG16 Network IR and the same Figure Plan builder as the product.
  $diagramJson = & .\node_modules\.bin\tsx.cmd scripts\generate-vgg16-figure-plan.mts
  if ($LASTEXITCODE -ne 0) { throw "Could not generate the canonical VGG16 Figure Plan." }
  $diagram = ($diagramJson -join "") | ConvertFrom-Json
  if (-not $diagram.figurePlan.validation.valid) { throw "Generated Figure Plan is invalid." }

  $request = [ordered]@{
    protocolVersion = 1
    requestId = "request-vgg16-" + [guid]::NewGuid().ToString("N")
    jobId = "job-vgg16-" + [guid]::NewGuid().ToString("N")
    mode = "live"
    outputPath = $output
    diagram = $diagram
  }
  $json = $request | ConvertTo-Json -Depth 32 -Compress
  $workerArgs = @("--mode", "live", "--output-root", $root)
  if (-not $Hidden) { $workerArgs += "--visible" }
  if ($AttachToRunning) { $workerArgs += "--attach-to-running" }
  $responseLines = @($json | dotnet run --no-restore --no-build --project workers/visio-worker/src/VisioWorker.Host/VisioWorker.Host.csproj -- @workerArgs)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "Visio COM Worker failed with exit code ${exitCode}: $($responseLines -join " ")" }
  $responseLine = ($responseLines | Where-Object { $_.Trim() } | Select-Object -Last 1)
  $response = $responseLine | ConvertFrom-Json
  if ($response.status -ne "succeeded" -or -not $response.readback.valid) { throw "VGG16 Visio render did not return a valid readback: $responseLine" }
  if (@($response.readback.missingPrimitiveIds).Count -ne 0 -or @($response.readback.missingConnectorIds).Count -ne 0 -or @($response.readback.shapeDataFailures).Count -ne 0) {
    throw "VGG16 Visio semantic readback failed: $responseLine"
  }
  if (@($response.readback.expectedPrimitiveIds).Count -lt 3 -or @($response.readback.actualPrimitiveIds).Count -ne @($response.readback.expectedPrimitiveIds).Count) {
    throw "VGG16 Visio semantic readback did not preserve every planned primitive: $responseLine"
  }
  if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw "VGG16 Visio output was not created: $output" }
  if ($Hidden) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($output)
    try { if ($null -eq $archive.GetEntry("visio/pages/page1.xml")) { throw "Generated .vsdx has no Visio page entry" } } finally { $archive.Dispose() }
  }

  if ($VerifyPreview) {
    $visio = $null
    $document = $null
    try {
      $visio = New-Object -ComObject Visio.Application
      $document = $visio.Documents.Open($output)
      $document.Pages.Item(1).Export($pngOutput)
    } finally {
      if ($null -ne $document) { $document.Close() }
      if ($null -ne $visio) { $visio.Quit() }
      if ($null -ne $document -and [Runtime.InteropServices.Marshal]::IsComObject($document)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
      if ($null -ne $visio -and [Runtime.InteropServices.Marshal]::IsComObject($visio)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($visio) }
    }
    if (-not (Test-Path -LiteralPath $pngOutput -PathType Leaf)) { throw "Visio did not export the VGG16 PNG: $pngOutput" }
  }

  if ($OpenOutput) { Start-Process -FilePath $output | Out-Null }
  Write-Output "VGG16 Visio smoke OK: $output"
  if ($VerifyPreview) { Write-Output "VGG16 Visio PNG: $pngOutput" }
  Write-Output ("readback shapeCount={0} connectorCount={1} primitives={2} connectors={3}" -f $response.readback.shapeCount, $response.readback.connectorCount, @($response.readback.actualPrimitiveIds).Count, @($response.readback.actualConnectorIds).Count)
} catch {
  Write-Error $_
  exit 1
} finally {
  Pop-Location
}
