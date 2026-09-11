# The independent integration is distributed as a versioned GitHub release until
# it is published on NuGet.org. Never depend on a sibling checkout or commit binaries.
$ErrorActionPreference = 'Stop'
$version = '0.1.0-preview.4'
$expectedHash = '8146F269D97C91F5A4A16676104A874D433BABC0EA575A8F34ECB34219228A48'
$packageName = "Aspire.Hosting.Garage.$version.nupkg"
$packageDirectory = Join-Path $PSScriptRoot '../.local/packages'
$packagePath = Join-Path $packageDirectory $packageName
New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
if ((Test-Path -LiteralPath $packagePath) -and (Get-FileHash -LiteralPath $packagePath).Hash -eq $expectedHash) {
    Write-Output "Garage integration $version is ready."
    exit 0
}
$downloadPath = "$packagePath.download"
Invoke-WebRequest "https://github.com/PatrickMatthiesen/Aspire.Hosting.Garage/releases/download/v$version/$packageName" -OutFile $downloadPath
if ((Get-FileHash -LiteralPath $downloadPath).Hash -ne $expectedHash) {
    throw 'Garage package checksum does not match the pinned release.'
}
Move-Item -LiteralPath $downloadPath -Destination $packagePath -Force
Write-Output "Restored and verified Garage integration $version."
