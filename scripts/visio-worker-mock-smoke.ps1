$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("synapse-visio-mock-" + [guid]::NewGuid().ToString("N"))
$output = Join-Path $root "job-1.vsdx"
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $request = [ordered]@{
    protocolVersion = 1
    requestId = "request-smoke"
    jobId = "job-smoke"
    mode = "mock"
    outputPath = $output
    diagram = [ordered]@{
      figure = [ordered]@{ title = "CNN"; stageLabels = @("Input", "Output") }
      nodes = @(
        [ordered]@{ id = "input"; kind = "tensor"; label = "Input"; stage = 0; x = 100; y = 100; width = 100; height = 100 },
        [ordered]@{ id = "conv"; kind = "conv"; label = "Conv"; stage = 0; x = 100; y = 300; width = 100; height = 100 },
        [ordered]@{ id = "output"; kind = "output"; label = "Output"; stage = 1; x = 700; y = 200; width = 100; height = 100 }
      )
      edges = @(
        [ordered]@{ id = "edge-signal"; source = "conv"; target = "output"; kind = "signal"; points = @(@{ x = 200; y = 350 }, @{ x = 700; y = 250 }) },
        [ordered]@{ id = "edge-skip"; source = "input"; target = "output"; kind = "skip"; points = @(@{ x = 200; y = 150 }, @{ x = 300; y = 50 }, @{ x = 600; y = 50 }, @{ x = 700; y = 250 }) }
      )
    }
  }
  $json = $request | ConvertTo-Json -Depth 12 -Compress
  $json | dotnet run --no-restore --no-build --project workers/visio-worker/src/VisioWorker.Host/VisioWorker.Host.csproj -- --mode mock --output-root $root
  if ($LASTEXITCODE -ne 0) { throw "Visio Worker mock process failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $output)) { throw "Mock Worker did not create $output" }
  Write-Output "Visio Worker mock smoke OK: $output"
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
