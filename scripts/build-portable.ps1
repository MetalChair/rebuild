<#
.SYNOPSIS
Builds a Windows x64 DietPro.exe with an embedded catalog from a local Diet Pro CSV export.
.EXAMPLE
./scripts/build-portable.ps1 -CsvDir 'C:/DietPro/DietProExport' -ImagesDir 'C:/DietPro/Images'
.NOTES
Requires Go, Node.js, npm, and a local export of the legacy t_*.csv tables. The CSV files and generated database are never tracked by Git.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CsvDir,
    [string]$ImagesDir,
    [string]$Output = 'DietPro.exe'
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

function Check-Command {
    if ($LASTEXITCODE) { throw "Command failed with exit code $LASTEXITCODE." }
}

New-Item -Path $scratch -ItemType Directory | Out-Null
Push-Location $repo
try {
    Push-Location web
    try {
        npm ci
        Check-Command
        npm run build
        Check-Command
    } finally {
        Pop-Location
    }

    $env:CGO_ENABLED = '0'
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

    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    go build -tags portable -trimpath -ldflags '-s -w -H=windowsgui' -o $target .
    Check-Command
    Write-Output $target
} finally {
    Pop-Location
    foreach ($file in @($importer, $db, "$db-wal", "$db-shm")) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $scratch
}
