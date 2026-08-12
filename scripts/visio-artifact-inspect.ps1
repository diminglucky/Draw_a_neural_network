param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [string]$PreviewPath
)

$ErrorActionPreference = "Stop"
$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
if ([System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant() -ne ".vsdx") {
  throw "Only .vsdx artifacts can be inspected"
}
if (-not $PreviewPath) {
  $PreviewPath = [System.IO.Path]::ChangeExtension($resolvedPath, ".png")
}
$previewDirectory = Split-Path -Parent $PreviewPath
if ($previewDirectory -and -not (Test-Path -LiteralPath $previewDirectory)) {
  New-Item -ItemType Directory -Path $previewDirectory | Out-Null
}

$visio = New-Object -ComObject Visio.Application
try {
  $visio.Visible = $false
  $document = $visio.Documents.Open($resolvedPath)
  try {
    $page = $document.Pages.Item(1)
    $page.Export($PreviewPath)
    Write-Output ("Initial open: shapes={0}; preview={1}" -f $page.Shapes.Count, $PreviewPath)
  } finally {
    $document.Close()
  }

  $reopened = $visio.Documents.Open($resolvedPath)
  try {
    $reopenedPage = $reopened.Pages.Item(1)
    Write-Output ("Independent reopen: shapes={0}" -f $reopenedPage.Shapes.Count)
  } finally {
    $reopened.Close()
  }
} finally {
  $visio.Quit()
}
