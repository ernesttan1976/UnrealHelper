param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir,

  # Defaults to this repo's plugin folder.
  [string]$PluginSource = "",

  # If set, deletes the existing plugin folder before copying.
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

if (-not $PluginSource) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $PluginSource = Join-Path $scriptDir "..\unreal-plugin\UnstuckForUnreal"
}

if (-not (Test-Path -LiteralPath $ProjectDir)) {
  throw "ProjectDir not found: $ProjectDir"
}

if (-not (Test-Path -LiteralPath $PluginSource)) {
  throw "PluginSource not found: $PluginSource"
}

$projectPathResolved = (Resolve-Path -LiteralPath $ProjectDir).Path
$pluginSourceFull = (Resolve-Path -LiteralPath $PluginSource).Path

# Allow passing either a project directory or a direct .uproject path.
$uprojectPath = $null
$projectDirFull = $null

if ($projectPathResolved.ToLowerInvariant().EndsWith(".uproject")) {
  $uprojectPath = $projectPathResolved
  $projectDirFull = Split-Path -Parent $uprojectPath
} else {
  $projectDirFull = $projectPathResolved
  $uproject = Get-ChildItem -LiteralPath $projectDirFull -Filter "*.uproject" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $uproject) {
    throw "No .uproject found in ProjectDir: $projectDirFull"
  }
  $uprojectPath = $uproject.FullName
}

$pluginsDir = Join-Path $projectDirFull "Plugins"
$destPluginDir = Join-Path $pluginsDir "UnstuckForUnreal"

New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null

if ($Clean -and (Test-Path -LiteralPath $destPluginDir)) {
  Remove-Item -LiteralPath $destPluginDir -Recurse -Force
}

Copy-Item -LiteralPath $pluginSourceFull -Destination $pluginsDir -Recurse -Force

Write-Host "Installed UnstuckForUnreal plugin to: $destPluginDir"
Write-Host "Next: enable plugin in UE (Edit -> Plugins), restart editor, then run mcp-server/probe with UNREAL_PROJECT_DIR."
