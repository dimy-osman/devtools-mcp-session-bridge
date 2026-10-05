# DTMSB install. Compiles the launch shim and registers it for Chrome and Brave.
# The next start of each browser picks up the internal DevTools port.
# This does not close the browsers you have open.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ShimCs = Join-Path $Root 'dtmsb-shim.cs'
$ShimExe = Join-Path $Root 'dtmsb-shim.exe'
$Gate = Join-Path $Root 'session-gate.cjs'

if (-not (Test-Path $ShimCs)) { throw "Missing $ShimCs" }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe was not found. Install the .NET Framework developer tools.' }

$built = Join-Path $Root 'dtmsb-shim.new.exe'
& $csc /nologo /optimize+ /target:exe "/out:$built" $ShimCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $built)) { throw 'Shim compile failed' }
if (Test-Path $ShimExe) {
	Remove-Item "$ShimExe.bak" -Force -ErrorAction SilentlyContinue
	Move-Item $ShimExe "$ShimExe.bak" -Force -ErrorAction SilentlyContinue
}
Move-Item $built $ShimExe -Force

foreach ($image in @('brave.exe', 'chrome.exe')) {
	$key = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\$image"
	New-Item -Path $key -Force | Out-Null
	Set-ItemProperty -Path $key -Name Debugger -Value "`"$ShimExe`""
	Write-Host "Registered $image"
}

$node = Join-Path $env:LOCALAPPDATA 'Programs\node\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

$foreign = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
	$_.CommandLine -match 'session-gate\.cjs' -and $_.CommandLine -notmatch [regex]::Escape($Root)
}
foreach ($proc in $foreign) {
	Write-Host "Stopping the previous session gate (pid $($proc.ProcessId))"
	Stop-Process -Id $proc.ProcessId -Force
	Start-Sleep -Milliseconds 400
}

$listening = Get-NetTCPConnection -LocalPort 9334 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
	Start-Process -FilePath $node -ArgumentList "`"$Gate`"" -WindowStyle Hidden
	Start-Sleep -Milliseconds 400
}

Write-Host ''
Write-Host 'DevTools MCP Session Bridge (DTMSB) is installed.'
Write-Host 'Load this folder as an unpacked extension in Chrome and in Brave:'
Write-Host (Join-Path $Root 'extension')
Write-Host ''
Write-Host 'Restart each browser once so the switch can own the attach port.'
Write-Host 'Brave attach URL:  http://127.0.0.1:9223'
Write-Host 'Chrome attach URL: http://127.0.0.1:9224'
Write-Host 'Some sites and human checks fail while the switch is on.'
Write-Host ''
