param(
  [switch]$Global,
  [string]$ProjectPath
)
$Source = Join-Path $PSScriptRoot '.claude\agents'
if ($Global) {
  $Dest = Join-Path $HOME '.claude\agents'
} elseif ($ProjectPath) {
  $Dest = Join-Path $ProjectPath '.claude\agents'
} else {
  Write-Error 'Usage: ./install.ps1 -Global OR ./install.ps1 -ProjectPath C:\path\to\repo'
  exit 2
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Dest -Recurse -Force
Write-Host "Installed Claude engineering agents to: $Dest"
Write-Host 'If this was the first agents directory created during a running Claude Code session, restart that session once.'
