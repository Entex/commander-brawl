# Installs or updates Commander Brawl for the current user on Windows. Run it again to update.
#
#   irm https://github.com/Entex/commander-brawl/releases/latest/download/install.ps1 | iex
#
# Or put this script next to commander-brawl-win32-x64.zip and choose "Run with PowerShell".
# The previous version is kept; to undo an update, run it with $env:CB_ROLLBACK = '1'.
#
# The app runs it too, to update itself, with CB_UPDATE=1 (start the app again afterwards, and leave the shortcuts
# alone), CB_ARCHIVE (the new version, already checked) and CB_INSTALL_DIR (where the app is, if not in the usual place).

$ErrorActionPreference = 'Stop'
# Windows PowerShell downloads very slowly while it draws a progress bar.
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:CB_REPO) { $env:CB_REPO } else { 'Entex/commander-brawl' }
$Update = $env:CB_UPDATE -eq '1'
$Asset = 'commander-brawl-win32-x64.zip'
$Root = if ($env:CB_INSTALL_DIR) { $env:CB_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'CommanderBrawl' }
$App = Join-Path $Root 'app'
$Previous = Join-Path $Root 'previous'
$Staging = Join-Path $Root 'staging'

function Start-App {
  $exe = Join-Path $App 'commander-brawl.exe'
  if (Test-Path $exe) { Start-Process -FilePath $exe -WorkingDirectory $App }
}

function Stop-RunningApp {
  # Only this copy of the app, not one installed somewhere else.
  $running = Get-Process -Name 'commander-brawl' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith("$App\", [StringComparison]::OrdinalIgnoreCase) }
  if ($running) {
    Write-Host 'Closing Commander Brawl...'
    foreach ($process in $running) {
      $process.CloseMainWindow() | Out-Null
      if (-not $process.WaitForExit(5000)) { $process.Kill() }
    }
  }
}

function Register-InviteLinks([string] $Exe) {
  # Invite links (commander-brawl://join/...) open the app, even before it has been started once.
  $key = 'HKCU:\Software\Classes\commander-brawl'
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  Set-Item -Path $key -Value 'URL:Commander Brawl invite'
  New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -Force | Out-Null
  Set-Item -Path "$key\shell\open\command" -Value "`"$Exe`" `"%1`""
}

function New-Shortcuts([string] $Exe) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $link = $shell.CreateShortcut((Join-Path $folder 'Commander Brawl.lnk'))
    $link.TargetPath = $Exe
    $link.WorkingDirectory = Split-Path $Exe
    $link.Save()
  }
}

if ($env:CB_ROLLBACK -eq '1') {
  if (-not (Test-Path $Previous)) { throw 'There is no previous version to go back to.' }
  Stop-RunningApp
  $swap = Join-Path $Root 'rollback'
  if (Test-Path $swap) { Remove-Item $swap -Recurse -Force }
  Move-Item $App $swap
  Move-Item $Previous $App
  Move-Item $swap $Previous
  Write-Host "Went back to Commander Brawl $((Get-Content (Join-Path $App 'app-version')).Trim())."
  return
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Staging | Out-Null

try {
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $Asset } else { $null }
  if ($env:CB_ARCHIVE) {
    $zip = $env:CB_ARCHIVE
  } elseif ($local -and (Test-Path $local)) {
    $zip = $local
  } else {
    $base = "https://github.com/$Repo/releases/latest/download"
    $zip = Join-Path $Staging $Asset
    $sumsFile = Join-Path $Staging 'SHA256SUMS'
    Write-Host 'Downloading Commander Brawl...'
    Invoke-WebRequest "$base/$Asset" -OutFile $zip -UseBasicParsing
    Invoke-WebRequest "$base/SHA256SUMS" -OutFile $sumsFile -UseBasicParsing
    $line = Get-Content $sumsFile | Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" } | Select-Object -First 1
    if (-not $line) { throw "The release has no checksum for $Asset." }
    $expected = ($line -split '\s+')[0]
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'The download is damaged (checksum mismatch). Try again.' }
  }

  Write-Host 'Unpacking...'
  # tar.exe ships with Windows 10 and 11 and is much faster than Expand-Archive.
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) {
    & $tar -xf $zip -C $Staging
    if ($LASTEXITCODE -ne 0) { throw "Could not unpack $Asset." }
  } else {
    Expand-Archive -Path $zip -DestinationPath $Staging -Force
  }
  $new = Join-Path $Staging 'commander-brawl'
  $exe = Join-Path $new 'commander-brawl.exe'
  if (-not (Test-Path $exe)) { throw "The archive doesn't contain the app." }

  # Files that came from the internet carry a mark that makes Windows warn about an unknown publisher.
  # This is our own app, so remove the mark.
  Get-ChildItem -Path $new -Recurse -File | Unblock-File
  $version = (Get-Content (Join-Path $new 'app-version')).Trim()

  Stop-RunningApp
  if (Test-Path $Previous) { Remove-Item $Previous -Recurse -Force }
  if (Test-Path $App) { Move-Item $App $Previous }
  Move-Item $new $App

  if ($Update) {
    Write-Host "Installed Commander Brawl $version."
    Start-App
  } else {
    New-Shortcuts (Join-Path $App 'commander-brawl.exe')
    Register-InviteLinks (Join-Path $App 'commander-brawl.exe')
    Write-Host "Installed Commander Brawl $version. Start it from the Start menu or the desktop shortcut."
    Write-Host 'The first time, Windows asks whether it may use the network. Allow private networks.'
  }
} catch {
  Write-Host "Error: $($_.Exception.Message)"
  # The app is waiting to be started again: put the previous version back if it was moved away, and start it.
  if ($Update) {
    if (-not (Test-Path $App) -and (Test-Path $Previous)) { Move-Item $Previous $App }
    Start-App
  }
  throw
} finally {
  Remove-Item $Staging -Recurse -Force -ErrorAction SilentlyContinue
}
