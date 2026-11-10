<#
.SYNOPSIS
Builds DietPro.exe with an embedded catalog from a local Diet Pro CSV export.
.EXAMPLE
./scripts/build-portable.ps1 -CsvDir 'C:/DietPro/DietProExport' -ImagesDir 'C:/DietPro/Images'
.NOTES
Run on Windows with Go, Node.js, npm, and a local export of the legacy t_*.csv tables.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CsvDir,
    [string]$ImagesDir,
    [string]$Output = 'DietPro.exe',
    [ValidateSet('amd64','arm64')][string]$Architecture = 'amd64',
    [ValidatePattern('^[0-9A-Za-z.-]+$')][string]$Version = 'dev'
)

$ErrorActionPreference = 'Stop'
$csv = (Resolve-Path -LiteralPath $CsvDir).Path
$images = if ($ImagesDir) { (Resolve-Path -LiteralPath $ImagesDir).Path }
$target = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$repo = Split-Path $PSScriptRoot
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('dietpro-build-' + [guid]::NewGuid())
$archive = Join-Path $repo 'catalog.db.gz'
$importer = Join-Path $scratch 'importer.exe'
$db = Join-Path $scratch 'catalog.db'
$originalGoOS = $env:GOOS
$originalGoArch = $env:GOARCH
$originalCGO = $env:CGO_ENABLED

function Check-Command {
    if ($LASTEXITCODE) { throw "Command failed with exit code $LASTEXITCODE." }
}

New-Item -Path $scratch -ItemType Directory | Out-Null
Push-Location $repo
try {
    Push-Location web
    try {
        npm.cmd ci
        Check-Command
        npm.cmd run build
        Check-Command
    } finally {
        Pop-Location
    }

    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = (go env GOHOSTARCH)
    Check-Command
    go build -o $importer .
    Check-Command
    $arguments = @('import', '-csv', $csv, '-db', $db)
    if ($images) { $arguments += @('-images', $images) }
    & $importer @arguments
    Check-Command

    $source = [IO.File]::OpenRead($db)
    try {
        $compressed = [IO.Compression.GZipStream]::new([IO.File]::Create($archive), [IO.Compression.CompressionLevel]::Optimal)
        try { $source.CopyTo($compressed) }
        finally { $compressed.Dispose() }
    } finally { $source.Dispose() }

    $env:GOARCH = $Architecture
    go build -tags portable -trimpath -ldflags "-s -w -H=windowsgui -X main.version=$Version" -o $target .
    Check-Command
    Write-Output $target
} finally {
    Pop-Location
    $env:GOOS = $originalGoOS
    $env:GOARCH = $originalGoArch
    $env:CGO_ENABLED = $originalCGO
    foreach ($file in @($importer, $db, "$db-wal", "$db-shm")) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $scratch
}
