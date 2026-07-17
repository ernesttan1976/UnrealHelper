<#
.SYNOPSIS
  Sync UnrealDebugCopilot into a UE project and build the Editor target.

.DESCRIPTION
  Does the equivalent of steps 2.2 (copy plugin into <Project>/Plugins) and 2.3 (build)
  from the earlier instructions.

.PARAMETER ProjectPath
  Path to a .uproject file, or a project directory containing exactly one .uproject.

.PARAMETER EngineRoot
  Unreal Engine root directory (the folder that contains Engine/Build/BatchFiles/Build.bat).
  If omitted, uses $env:UE_ENGINE_ROOT.

.PARAMETER Configuration
  Build configuration. Defaults to Development.

.PARAMETER Platform
  Build platform. Defaults to Win64.

.EXAMPLE
  ./scripts/sync-plugin-and-build.ps1 "D:/UEProjects/BlueprintLesson/BlueprintLesson/BlueprintLesson.uproject" -EngineRoot "C:/Program Files/Epic Games/UE_5.6"

.EXAMPLE
  $env:UE_ENGINE_ROOT = "C:/Program Files/Epic Games/UE_5.6"
  ./scripts/sync-plugin-and-build.ps1 "D:/UEProjects/BlueprintLesson/BlueprintLesson/BlueprintLesson"
#>

param(
  [Parameter(Mandatory = $false, Position = 0)]
  [string]$ProjectPath,

  [Parameter(Mandatory = $false)]
  [string]$EngineRoot,

  [Parameter(Mandatory = $false)]
  [ValidateSet("Development", "DebugGame", "Debug")]
  [string]$Configuration = "Development",

  [Parameter(Mandatory = $false)]
  [ValidateSet("Win64")]
  [string]$Platform = "Win64"
)

$ErrorActionPreference = "Stop"

function Import-DotEnv([string]$DotEnvPath) {
  if ([string]::IsNullOrWhiteSpace($DotEnvPath)) {
    return
  }
  if (!(Test-Path -LiteralPath $DotEnvPath)) {
    return
  }

  $lines = Get-Content -LiteralPath $DotEnvPath -ErrorAction Stop
  foreach ($line in $lines) {
    $t = $line.Trim()
    if ($t.Length -eq 0) { continue }
    if ($t.StartsWith("#")) { continue }
    $idx = $t.IndexOf("=")
    if ($idx -lt 1) { continue }

    $key = $t.Substring(0, $idx).Trim()
    $value = $t.Substring($idx + 1)
    if ($key.Length -eq 0) { continue }

    # Only populate if not already set so CLI/env can override.
    $existing = [Environment]::GetEnvironmentVariable($key)
    if ([string]::IsNullOrEmpty($existing)) {
      Set-Item -Path ("Env:" + $key) -Value $value
    }
  }
}

function Resolve-UProjectPath([string]$PathInput) {
  $p = Resolve-Path $PathInput
  if ($p.Path.ToLowerInvariant().EndsWith(".uproject")) {
    return $p.Path
  }

  $uprojects = Get-ChildItem -LiteralPath $p.Path -Filter "*.uproject" -File
  if ($uprojects.Count -eq 0) {
    throw "No .uproject found in directory: $($p.Path)"
  }
  if ($uprojects.Count -gt 1) {
    $names = ($uprojects | ForEach-Object { $_.Name }) -join ", "
    throw "Multiple .uproject files found in directory: $($p.Path). Specify one explicitly. Found: $names"
  }
  return $uprojects[0].FullName
}

function Resolve-EngineRoot([string]$EngineRootArg) {
  $root = $EngineRootArg
  if ([string]::IsNullOrWhiteSpace($root)) {
    $root = $env:UE_ENGINE_ROOT
  }

  if ([string]::IsNullOrWhiteSpace($root)) {
    throw "EngineRoot not provided. Pass -EngineRoot or set UE_ENGINE_ROOT."
  }

  $rootResolved = (Resolve-Path $root).Path
  $buildBat = Join-Path $rootResolved "Engine/Build/BatchFiles/Build.bat"
  if (!(Test-Path $buildBat)) {
    throw "Build.bat not found at: $buildBat (EngineRoot was: $rootResolved)"
  }
  return $rootResolved
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

# If present, load repo-root .env for UNREAL_PROJECT_DIR / UE_ENGINE_ROOT defaults.
Import-DotEnv (Join-Path $repoRoot ".env")

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
  if ([string]::IsNullOrWhiteSpace($env:UNREAL_PROJECT_DIR)) {
    throw "ProjectPath not provided. Pass a .uproject path / project directory, or set UNREAL_PROJECT_DIR in .env."
  }
  $ProjectPath = $env:UNREAL_PROJECT_DIR
}

$uprojectPath = Resolve-UProjectPath $ProjectPath
$projectName = [System.IO.Path]::GetFileNameWithoutExtension($uprojectPath)
$engineRootResolved = Resolve-EngineRoot $EngineRoot

Write-Host "Project: $uprojectPath"
Write-Host "Engine:  $engineRootResolved"
Write-Host "Target:  ${projectName}Editor $Platform $Configuration"

# Step 2.2: copy plugin into <Project>/Plugins/UnrealDebugCopilot
& (Join-Path $repoRoot "scripts/install-plugin.ps1") (Split-Path -Parent $uprojectPath)

# Step 2.3: build the Editor target so the plugin compiles
$buildBat = Join-Path $engineRootResolved "Engine/Build/BatchFiles/Build.bat"

Write-Host "Building... (make sure Unreal Editor is closed)"
& $buildBat "${projectName}Editor" $Platform $Configuration "-Project=$uprojectPath" -WaitMutex -NoHotReloadFromIDE
if ($LASTEXITCODE -ne 0) {
  throw "Build failed with exit code $LASTEXITCODE"
}

Write-Host "OK"
