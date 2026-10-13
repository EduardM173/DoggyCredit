$panelUrl = 'http://127.0.0.1:4400/'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$runtimePath = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$existing = Get-NetTCPConnection -State Listen -LocalPort 4400 -ErrorAction SilentlyContinue
if (-not $existing) {
  Start-Process -FilePath $nodePath -ArgumentList 'tools/control-center/server.mjs' -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'panel.log') -RedirectStandardError (Join-Path $runtimePath 'panel-error.log')
  $ready = $false
  foreach ($attempt in 1..10) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest "${panelUrl}api/status" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw "El panel no inició. Revisa $runtimePath/panel-error.log" }
}
Start-Process $panelUrl
