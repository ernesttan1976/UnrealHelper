<#
.SYNOPSIS
  Copies the UnrealDebugCopilot plugin into a UE project.

.EXAMPLE
  ./scripts/install-plugin.ps1 "D:/Projects/MyGame/MyGame.uproject"

.EXAMPLE
  ./scripts/install-plugin.ps1 "D:/Projects/MyGame"
#>

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ProjectPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$src = Join-Path $repoRoot "unreal-plugin/UnrealDebugCopilot"
if (!(Test-Path $src)) {
  throw "Plugin source not found: $src"
}

$project = Resolve-Path $ProjectPath
if ($project.Path.ToLowerInvariant().EndsWith(".uproject")) {
  $projectDir = Split-Path -Parent $project.Path
} else {
  $projectDir = $project.Path
}

$pluginsDir = Join-Path $projectDir "Plugins"
$dst = Join-Path $pluginsDir "UnrealDebugCopilot"

if (!(Test-Path $pluginsDir)) {
  New-Item -ItemType Directory -Path $pluginsDir | Out-Null
}

Write-Host "Copying plugin"
Write-Host "  from: $src"
Write-Host "    to: $dst"

# Copy/overwrite files without deleting anything in the destination.
robocopy $src $dst /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

Write-Host "OK"
