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

$NativeCs = Join-Path $Root 'dtmsb-native.cs'
$NativeExe = Join-Path $Root 'dtmsb-native.exe'
if (-not (Test-Path $NativeCs)) { throw "Missing $NativeCs" }
$mgmt = Join-Path (Split-Path $csc) 'System.Management.dll'
$nativeBuilt = Join-Path $Root 'dtmsb-native.new.exe'
& $csc /nologo /optimize+ /target:exe "/r:$mgmt" "/out:$nativeBuilt" $NativeCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $nativeBuilt)) { throw 'Native host compile failed' }
if (Test-Path $NativeExe) {
	Remove-Item "$NativeExe.bak" -Force -ErrorAction SilentlyContinue
	Move-Item $NativeExe "$NativeExe.bak" -Force -ErrorAction SilentlyContinue
}
Move-Item $nativeBuilt $NativeExe -Force

$manifestPath = Join-Path $Root 'extension\manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.key) { throw 'extension manifest is missing key' }
$spki = [Convert]::FromBase64String($manifest.key)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$hash = $sha256.ComputeHash($spki)
$alphabet = 'abcdefghijklmnop'.ToCharArray()
$idChars = foreach ($byte in $hash[0..15]) {
	$alphabet[$byte -shr 4]
	$alphabet[$byte -band 15]
}
$extId = -join $idChars
Write-Host "Extension id $extId"
$hostJson = Join-Path $Root 'dtmsb-native.json'
$escapedPath = $NativeExe.Replace('\', '\\')
$json = @"
{
  "name": "com.dtmsb.helper",
  "description": "Starts the DevTools MCP Session Bridge local switch.",
  "path": "$escapedPath",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extId/"]
}
"@
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($hostJson, $json.Trim(), $utf8)
foreach ($reg in @(
	'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dtmsb.helper',
	'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.dtmsb.helper'
)) {
	New-Item -Path $reg -Force | Out-Null
	Set-Item -Path $reg -Value $hostJson
	Write-Host "Registered helper for $reg"
}

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
Write-Host 'If the toolbar says the local switch is not running, use Restart browser.'
Write-Host 'Reload the extension after this install so that button can start the switch.'
Write-Host 'Brave attach URL:  http://127.0.0.1:9223'
Write-Host 'Chrome attach URL: http://127.0.0.1:9224'
Write-Host 'Some sites and human checks fail while the switch is on.'
Write-Host ''
