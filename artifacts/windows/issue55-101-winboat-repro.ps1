param(
    [string]$Repo = '',
    [string]$OutDir = '',
    [string]$MirrorOutDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'issue55_101_winboat_repro.ps1'
& $scriptPath @PSBoundParameters
if ($LASTEXITCODE -ne $null) {
    exit $LASTEXITCODE
}
