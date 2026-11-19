param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$StRoot = 'D:\Games\SillyTavern\SillyTavern',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$extensions = Join-Path $StRoot 'data\default-user\extensions'
$link = Join-Path $extensions $Name

if ($Remove) {
    if (-not (Test-Path $link)) {
        Write-Host "Not found: $link"
        exit 0
    }
    $item = Get-Item -LiteralPath $link -Force
    if ($item.LinkType -ne 'Junction' -and $item.LinkType -ne 'SymbolicLink') {
        throw "Refusing to remove a real directory: $link"
    }
    cmd /c rmdir "$link"
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove junction: $link" }
    Write-Host "Removed junction: $link"
    exit 0
}

$Source = [IO.Path]::GetFullPath($Source)
if (-not (Test-Path (Join-Path $Source 'manifest.json'))) {
    throw "Source does not contain manifest.json: $Source"
}
if (Test-Path $link) {
    throw "Extension link already exists: $link (use -Remove first)"
}

New-Item -ItemType Directory -Force -Path $extensions | Out-Null
cmd /c mklink /J "$link" "$Source"
if ($LASTEXITCODE -ne 0) { throw "Failed to create junction: $link" }

Write-Host "Linked: $link -> $Source"
Write-Host 'Refresh SillyTavern (Ctrl+F5) to load it.'
Write-Host 'Remember to remove this junction before installing the same extension from GitHub.'
