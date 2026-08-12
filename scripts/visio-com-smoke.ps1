param(
  [switch]$KeepOutput
)

$ErrorActionPreference = "Stop"

$progId = "Visio.Application"
try {
  $visioType = [type]::GetTypeFromProgID($progId)
} catch {
  $visioType = $null
}
if ($null -eq $visioType) {
  Write-Error "VISIO_UNAVAILABLE: COM ProgID $progId is not registered"
  exit 2
}

$root = Join-Path ([System.IO.Path]::GetTempPath()) ("synapse-visio-live-" + [guid]::NewGuid().ToString("N"))
$output = Join-Path $root "job-live-smoke.vsdx"
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $request = [ordered]@{
    protocolVersion = 1
    requestId = "request-live-smoke"
    jobId = "job-live-smoke"
    mode = "live"
    outputPath = $output
    diagram = [ordered]@{
      figure = [ordered]@{ title = "CNN live smoke"; stageLabels = @("Input", "Output") }
      nodes = @(
        [ordered]@{ id = "input"; kind = "tensor"; label = "Input"; stage = 0; x = 100; y = 100; width = 100; height = 100 },
        [ordered]@{ id = "output"; kind = "output"; label = "Output"; stage = 1; x = 700; y = 100; width = 100; height = 100 }
      )
      edges = @(
        [ordered]@{ id = "edge-signal"; source = "input"; target = "output"; kind = "signal"; points = @(@{ x = 200; y = 150 }, @{ x = 700; y = 150 }) }
      )
    }
  }
  $json = $request | ConvertTo-Json -Depth 12 -Compress
  $responseLines = @($json | dotnet run --no-restore --no-build --project workers/visio-worker/src/VisioWorker.Host/VisioWorker.Host.csproj -- --mode live --output-root $root)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Visio COM Worker failed with exit code ${exitCode}: $($responseLines -join " ")"
  }
  $responseLine = ($responseLines | Where-Object { $_.Trim() } | Select-Object -Last 1)
  if (-not $responseLine) { throw "Visio COM Worker returned no response" }
  $response = $responseLine | ConvertFrom-Json
  if ($response.status -ne "succeeded" -or -not $response.readback.valid) {
    throw "Visio COM Worker did not return a valid readback: $responseLine"
  }
  if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw "Visio COM Worker did not create $output" }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($output)
  try {
    if ($null -eq $archive.GetEntry("visio/pages/page1.xml")) {
      throw "The generated .vsdx package has no Visio page entry"
    }
  } finally {
    $archive.Dispose()
  }
  Write-Output "Visio COM smoke OK: $output"
  Write-Output ("readback shapeCount={0} connectorCount={1}" -f $response.readback.shapeCount, $response.readback.connectorCount)
} catch {
  Write-Error $_
  exit 1
} finally {
  if (-not $KeepOutput -and (Test-Path -LiteralPath $root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}
