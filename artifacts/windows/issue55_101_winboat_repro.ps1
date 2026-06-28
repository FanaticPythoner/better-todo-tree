param(
    [string]$Repo = '',
    [string]$OutDir = '',
    [string]$MirrorOutDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = if ($Repo -ne '') { $Repo } else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$outDir = if ($OutDir -ne '') { $OutDir } else { Join-Path $repo 'artifacts\windows' }
$outPath = Join-Path $outDir 'issue55_101_winboat_repro.json'
$publicOutPath = Join-Path $outDir 'issue55_101_winboat_repro.public.json'
$work = Join-Path $env:TEMP 'btt-issue55-101-winboat'
$io = Join-Path $env:TEMP 'btt-issue55-101-winboat-io'
$rg = Join-Path $repo 'node_modules\@vscode\ripgrep-universal\bin\win32-x64\rg.exe'
$tracePath = Join-Path $outDir 'issue55_101_winboat_repro.trace.txt'

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Add-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($Path, $Value + "`n", $encoding)
}

function Write-Trace {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $line = (Get-Date).ToString('o') + ' ' + $Message
    Add-Utf8NoBom -Path $tracePath -Value $line
    Write-Output $line
}

function Copy-WithCmd {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    & cmd.exe /c copy /y $Source $Destination | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "copy failed: $Source -> $Destination"
    }
}

function Convert-JsonString {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return 'null'
    }

    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    $escaped = $escaped.Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    return '"' + $escaped + '"'
}

function Convert-JsonValue {
    param(
        [AllowNull()]
        $Value
    )

    if ($null -eq $Value) {
        return 'null'
    }

    if ($Value -is [bool]) {
        if ($Value) {
            return 'true'
        }

        return 'false'
    }

    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or
        $Value -is [int64] -or $Value -is [decimal] -or $Value -is [double] -or
        $Value -is [single]) {
        return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0}', $Value)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $members = foreach ($key in $Value.Keys) {
            (Convert-JsonString ([string]$key)) + ':' + (Convert-JsonValue $Value[$key])
        }
        return '{' + ($members -join ',') + '}'
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $items = foreach ($item in $Value) {
            Convert-JsonValue $item
        }
        return '[' + ($items -join ',') + ']'
    }

    return Convert-JsonString ([string]$Value)
}

function Invoke-Rg {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory
    )

    $stdout = Join-Path $io ([System.Guid]::NewGuid().ToString() + '.stdout.txt')
    $stderr = Join-Path $io ([System.Guid]::NewGuid().ToString() + '.stderr.txt')
    $process = Start-Process -FilePath $rg -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    return [ordered]@{
        exitCode = $process.ExitCode
        stdout = if (Test-Path $stdout) { Get-Content -LiteralPath $stdout -Raw } else { '' }
        stderr = if (Test-Path $stderr) { Get-Content -LiteralPath $stderr -Raw } else { '' }
        args = $Arguments
    }
}

function Convert-PublicPath {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return $null
    }

    return $Value.Replace($repo, '<repo>').Replace($work, '<work>').Replace($io, '<io>')
}

function Convert-RgJsonLines {
    param(
        [AllowNull()]
        [string]$Stdout
    )

    if ($null -eq $Stdout -or $Stdout -eq '') {
        return @()
    }

    $records = foreach ($line in ($Stdout -split "`r?`n")) {
        if ($line -ne '') {
            $line | ConvertFrom-Json
        }
    }

    return @($records)
}

function New-PublicScanSummary {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Scan
    )

    $records = Convert-RgJsonLines -Stdout $Scan.stdout
    $matches = @($records | Where-Object { $_.type -eq 'match' })
    $paths = @($matches | ForEach-Object { $_.data.path.text } | Sort-Object -Unique)

    return [ordered]@{
        exitCode = $Scan.exitCode
        lineCount = @($records).Count
        matchRecords = $matches.Count
        paths = $paths
        stderrPresent = ($Scan.stderr -ne $null -and $Scan.stderr -ne '')
        args = $Scan.args
    }
}

function Convert-PublicIdentity {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value -or $Value -eq '') {
        return 'unknown'
    }

    if ($Value -like '*SYSTEM') {
        return 'system'
    }

    return 'current-user'
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Write-Utf8NoBom -Path $tracePath -Value ((Get-Date).ToString('o') + ' start' + "`n")
if (Test-Path $work) {
    Write-Trace 'remove-work'
    icacls $work /remove:d "${env:USERNAME}" /t /c | Out-Null
    icacls $work /reset /t /c | Out-Null
    Remove-Item -LiteralPath $work -Recurse -Force
}
if (Test-Path $io) {
    Write-Trace 'remove-io'
    Remove-Item -LiteralPath $io -Recurse -Force
}
Write-Trace 'create-work'
New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $io | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $work 'config') | Out-Null

Write-Trace 'write-fixtures'
Set-Content -LiteralPath (Join-Path $work 'visible.py') -Value '# NOTE visible py' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $work '.env') -Value '# NOTE hidden env' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $work '.env.example') -Value '# NOTE env example' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $work 'config\settings.json') -Value '// NOTE json item' -Encoding UTF8
Set-Content -LiteralPath (Join-Path $work 'config\settings.jsonc') -Value '// NOTE jsonc item' -Encoding UTF8

$deniedPath = Join-Path $work '.denied'
New-Item -ItemType Directory -Force -Path $deniedPath | Out-Null
Set-Content -LiteralPath (Join-Path $deniedPath 'blocked.txt') -Value '# NOTE blocked' -Encoding UTF8
attrib +h (Join-Path $work '.env')
attrib +h $deniedPath

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$aclIdentity = if ($currentIdentity -ne '') { $currentIdentity } else { $env:USERNAME }
$denyApplied = $false
try {
    Write-Trace 'apply-deny'
    $deny = icacls $deniedPath /deny "${aclIdentity}:(OI)(CI)F" 2>&1
    $denyApplied = $LASTEXITCODE -eq 0
} catch {
    $deny = $_.Exception.Message
}

Write-Trace 'default-scan'
$baseArgs = @('--no-messages', '--json', '--color', 'never', '-e', 'NOTE')
$defaultScan = Invoke-Rg -Arguments ($baseArgs + @('.')) -WorkingDirectory $work
Write-Trace 'hidden-scan'
$hiddenScan = Invoke-Rg -Arguments ($baseArgs + @('--hidden', '.')) -WorkingDirectory $work
Write-Trace 'explicit-env-scan'
$explicitEnvScan = Invoke-Rg -Arguments ($baseArgs + @('-g', '**/.env', '-g', '**/.env*', '.')) -WorkingDirectory $work
Write-Trace 'explicit-json-scan'
$explicitJsonScan = Invoke-Rg -Arguments ($baseArgs + @('-g', '**/*.json', '-g', '**/*.jsonc', '.')) -WorkingDirectory $work
Write-Trace 'rg-version'
$rgVersionScan = Invoke-Rg -Arguments @('--version') -WorkingDirectory $work
$rgVersion = ($rgVersionScan.stdout -split "`r?`n")[0]

if ($denyApplied) {
    Write-Trace 'remove-deny'
    icacls $deniedPath /remove:d "${aclIdentity}" | Out-Null
}

Write-Trace 'collect-summary'
$summary = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    os = [System.Environment]::OSVersion.VersionString
    powershell = $PSVersionTable.PSVersion.ToString()
    rgPath = $rg
    rgVersion = $rgVersion
    rgVersionScan = $rgVersionScan
    work = $work
    aclIdentity = $aclIdentity
    denyApplied = $denyApplied
    denyOutput = "$deny"
    defaultScan = $defaultScan
    hiddenScan = $hiddenScan
    explicitEnvScan = $explicitEnvScan
    explicitJsonScan = $explicitJsonScan
}

Write-Trace 'write-json'
Write-Utf8NoBom -Path $outPath -Value (Convert-JsonValue $summary)

$publicSummary = [ordered]@{
    timestamp = $summary.timestamp
    os = $summary.os
    powershell = $summary.powershell
    rgPath = Convert-PublicPath $summary.rgPath
    rgVersion = $summary.rgVersion
    work = Convert-PublicPath $summary.work
    aclIdentityKind = Convert-PublicIdentity $summary.aclIdentity
    denyApplied = $summary.denyApplied
    defaultScan = New-PublicScanSummary $summary.defaultScan
    hiddenScan = New-PublicScanSummary $summary.hiddenScan
    explicitEnvScan = New-PublicScanSummary $summary.explicitEnvScan
    explicitJsonScan = New-PublicScanSummary $summary.explicitJsonScan
}
Write-Utf8NoBom -Path $publicOutPath -Value (Convert-JsonValue $publicSummary)
Write-Trace 'done'
if ($MirrorOutDir -ne '') {
    Copy-WithCmd -Source $outPath -Destination (Join-Path $MirrorOutDir 'issue55_101_winboat_repro.json')
    Copy-WithCmd -Source $publicOutPath -Destination (Join-Path $MirrorOutDir 'issue55_101_winboat_repro.public.json')
    Copy-WithCmd -Source $tracePath -Destination (Join-Path $MirrorOutDir 'issue55_101_winboat_repro.trace.txt')
}
Write-Output $outPath
