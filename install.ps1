# Install the DeepTutor agent plugin into Magpie.
#
#   powershell -c "irm https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.ps1 | iex"
#
# Optional: -Home <workspace> overrides discovery; -CheckOnly only prints it.
# Set MAGPIE_BIN to point at the magpie executable when it is not on PATH.
param(
    [Alias('Home')]
    [string]$Workspace,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$Repo = 'github:Emilia06120878/magpie-agent-deeptutor'

function Test-DeepTutorHome([string]$Path) {
    if (-not $Path) { return $false }
    return Test-Path -LiteralPath (Join-Path $Path 'data\user\settings\model_catalog.json') -PathType Leaf
}

function Resolve-DeepTutorHome {
    if ($Workspace) {
        $explicit = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Workspace)
        if (-not (Test-DeepTutorHome $explicit)) {
            throw "No data\user\settings\model_catalog.json under $explicit. Start DeepTutor once or pass the correct -Home."
        }
        return $explicit
    }

    # Prefer the managed desktop workspace when both old and new editions exist.
    # LOCALAPPDATA makes this rule independent of user name, drive and app location.
    if ($env:LOCALAPPDATA) {
        $desktop = Join-Path $env:LOCALAPPDATA 'Open DeepTutor\workspace'
        if (Test-DeepTutorHome $desktop) { return $desktop }
    }

    $candidates = @($env:DEEPTUTOR_HOME, (Get-Location).Path)
    if ($env:USERPROFILE) {
        $candidates += @(
            (Join-Path $env:USERPROFILE '.deeptutor'),
            (Join-Path $env:USERPROFILE 'DeepTutor\workspace'),
            (Join-Path $env:USERPROFILE 'deeptutor\workspace')
        )
    }
    if ($env:LOCALAPPDATA) {
        $candidates += Join-Path $env:LOCALAPPDATA 'DeepTutor\workspace'
    }
    if ($env:ProgramFiles) {
        $candidates += Join-Path $env:ProgramFiles 'DeepTutor\workspace'
    }
    foreach ($candidate in $candidates) {
        if (Test-DeepTutorHome $candidate) {
            return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($candidate)
        }
    }

    throw 'DeepTutor was not found. Open it once to create its workspace, or run install.ps1 -Home <workspace>.'
}

function Find-Magpie {
    if ($env:MAGPIE_BIN -and (Test-Path -LiteralPath $env:MAGPIE_BIN)) {
        return (Resolve-Path -LiteralPath $env:MAGPIE_BIN).Path
    }
    $found = Get-Command magpie -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Magpie\magpie.exe'),
        (Join-Path $env:LOCALAPPDATA 'Magpie\magpie.exe'),
        (Join-Path $env:LOCALAPPDATA 'Magpie\magpie-windows-amd64.exe'),
        (Join-Path $env:ProgramFiles 'Magpie\magpie.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$selectedHome = Resolve-DeepTutorHome
Write-Host "DeepTutor workspace: $selectedHome"
if ($CheckOnly) { exit 0 }

# The moejs descriptor expands this variable. Set it for this installer and for
# future Magpie GUI/CLI processes; never infer it from a machine-specific path.
$env:DEEPTUTOR_HOME = $selectedHome

$magpie = Find-Magpie
if (-not $magpie) {
    throw 'magpie was not found. Install Magpie first: https://usemagpie.ai'
}

Write-Host "magpie: $magpie"
Write-Host "adding $Repo"
& $magpie plugin add $Repo
$code = $LASTEXITCODE
if ($null -ne $code -and $code -ne 0) {
    throw "magpie plugin add failed (exit $code)"
}

# Persist only after a successful install; the process variable above is enough
# for the plugin host while `magpie plugin add` is running.
[Environment]::SetEnvironmentVariable('DEEPTUTOR_HOME', $selectedHome, 'User')

Write-Host ''
Write-Host 'Installed. Restart Magpie so its desktop process inherits DEEPTUTOR_HOME.'
Write-Host 'Then:'
Write-Host '  1. Magpie -> Agents -> DeepTutor -> pick a model'
Write-Host '  2. DeepTutor -> Settings -> model list -> the Magpie profile'
Write-Host ''
& $magpie ls | Select-String -Pattern 'DeepTutor'
