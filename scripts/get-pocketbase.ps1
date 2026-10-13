# Fetches the pinned PocketBase release into server\ (Windows, amd64 and arm64).
# On Linux or macOS use scripts/get-pocketbase.sh.
#
# Upgrades are a deliberate change, never automatic: bump $PbVersion and both checksums below together
# (copy them from checksums.txt on the release page; get-pocketbase.sh has its own list), commit, then
# run this script again. Never use `pocketbase update`.
#
# Safe to re-run: it does nothing when server\pocketbase.exe already reports $PbVersion, and it replaces the
# binary when the version differs. The download is checked against the SHA-256 below before anything is
# extracted, and only pocketbase.exe is taken from the archive. Stop the PocketBase service before an
# upgrade: Windows cannot replace a running .exe.
#
# Run it with:  powershell -ExecutionPolicy Bypass -File scripts\get-pocketbase.ps1
$ErrorActionPreference = 'Stop'

$PbVersion = '0.40.5'

# SHA-256 of pocketbase_<version>_<os>_<arch>.zip
$Checksums = @{
  'windows_amd64' = 'd0980d1f3a8097ff4c03a876e8c98f3008a83c0d42cc03b636bc92b2d4788d1c'
  'windows_arm64' = '7dd0d7c500812cac571e450525595b93556527161b1eb86493dabdfc31974ef5'
}

$ServerDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'server'
$Bin = Join-Path $ServerDir 'pocketbase.exe'

# A 32-bit PowerShell on 64-bit Windows reports x86 in PROCESSOR_ARCHITECTURE; the real CPU is in PROCESSOR_ARCHITEW6432.
$Cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($Cpu) {
  'AMD64' { $Platform = 'windows_amd64' }
  'ARM64' { $Platform = 'windows_arm64' }
  default { throw "Unsupported CPU '$Cpu' (need amd64 or arm64)." }
}
$Expected = $Checksums[$Platform]

# "pocketbase version 0.40.5" -> "0.40.5"; empty when the file is missing or does not run.
function Get-PocketBaseVersion([string]$Path) {
  if (-not (Test-Path $Path)) { return '' }
  try { return ((& $Path --version) -join ' ').Trim().Split(' ')[-1] } catch { return '' }
}

if ((Get-PocketBaseVersion $Bin) -eq $PbVersion) {
  Write-Host "PocketBase $PbVersion is already installed: $Bin"
  return
}

New-Item -ItemType Directory -Force -Path $ServerDir | Out-Null
$Work = Join-Path $ServerDir ('.get-pocketbase.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
try {
  $Url = "https://github.com/pocketbase/pocketbase/releases/download/v${PbVersion}/pocketbase_${PbVersion}_${Platform}.zip"
  $Zip = Join-Path $Work 'pocketbase.zip'
  Write-Host "Downloading $Url"
  # Windows PowerShell 5.1 may default to protocols GitHub refuses, and its progress bar slows downloads to a crawl.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Zip).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) {
    throw "Checksum mismatch for $Url`n  expected $Expected`n  got      $Actual`nRefusing to install. If you are upgrading, update the pinned checksums to match `$PbVersion."
  }
  Write-Host 'Checksum OK'

  $Unpacked = Join-Path $Work 'unpacked'
  Expand-Archive -Path $Zip -DestinationPath $Unpacked -Force
  $New = Join-Path $Unpacked 'pocketbase.exe'
  if (-not (Test-Path $New)) { throw 'pocketbase.exe was not found in the archive.' }
  if ((Get-PocketBaseVersion $New) -ne $PbVersion) { throw 'The downloaded binary does not run on this machine or reports a different version.' }

  try {
    Move-Item -Force -Path $New -Destination $Bin
  } catch {
    throw "Could not replace $Bin. If PocketBase is running (for example as a service), stop it and run this again. $($_.Exception.Message)"
  }
  Write-Host "Installed PocketBase ${PbVersion}: $Bin"
} finally {
  Remove-Item -Recurse -Force -Path $Work -ErrorAction SilentlyContinue
}
