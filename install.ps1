# Install the DeepTutor agent plugin into Magpie.
#
#   powershell -c "irm https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.ps1 | iex"
#
# Set MAGPIE_BIN to point at the magpie executable when it is not on PATH.

$ErrorActionPreference = 'Stop'

$Repo = 'github:Emilia06120878/magpie-agent-deeptutor'

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

Write-Host ''
Write-Host 'Installed. Next:'
Write-Host '  1. Magpie -> Agents -> DeepTutor -> pick a model'
Write-Host '  2. DeepTutor -> Settings -> model list -> the Magpie profile'
Write-Host ''
& $magpie ls | Select-String -Pattern 'DeepTutor'
