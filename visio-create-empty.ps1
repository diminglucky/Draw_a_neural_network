param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPathBase64
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($TargetPathBase64 -eq "__STDIN__") {
  $TargetPathBase64 = [Console]::In.ReadToEnd()
}
$TargetPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TargetPathBase64.Trim()))

$visio = $null
try {
  if ([string]::IsNullOrWhiteSpace($TargetPath)) { throw "TargetPath is required." }
  $visio = New-Object -ComObject Visio.Application
  try { $visio.Visible = $false } catch {}
  $doc = $visio.Documents.Add("")
  try { $doc.SaveAsEx($TargetPath, 20) } catch { $doc.SaveAs($TargetPath) }
  $savedPath = [string]$doc.FullName
  $doc.Close()
  $visio.Quit()
  $visio = $null
  $result = [ordered]@{ status = "created"; documentPath = $savedPath }
  Write-Output ($result | ConvertTo-Json -Compress)
} catch {
  $detail = $_.Exception.GetType().FullName + " | " + $_.Exception.Message
  if ($_.Exception.InnerException) { $detail += " | inner: " + $_.Exception.InnerException.Message }
  $detail = ($detail -replace '[\r\n]', ' ')
  $result = [ordered]@{ status = "error"; message = $detail }
  Write-Output ($result | ConvertTo-Json -Compress)
  if ($null -ne $visio) { try { $visio.Quit() } catch {} }
  exit 1
}
