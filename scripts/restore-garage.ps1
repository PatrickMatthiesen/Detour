# The independent integration is distributed as a versioned GitHub release until
# it is published on NuGet.org. Never depend on a sibling checkout or commit binaries.
$ErrorActionPreference = 'Stop'
$version = '0.1.0-preview.3'
$expectedHash = '2EDB32CE333BE5562AE7FE9B44D2977A8E5A7CFD9EB21F11FD94291F6A758E3D'
$packageName = "CommunityToolkit.Aspire.Hosting.Garage.$version.nupkg"
$packageDirectory = Join-Path $PSScriptRoot '../.local/packages'
$packagePath = Join-Path $packageDirectory $packageName
New-Item -ItemType Directory -Force -Path $packageDirectory | Out-Null
if ((Test-Path -LiteralPath $packagePath) -and (Get-FileHash -LiteralPath $packagePath).Hash -eq $expectedHash) {
    Write-Output "Garage integration $version is ready."
    exit 0
}
$downloadPath = "$packagePath.download"
Invoke-WebRequest "https://github.com/PatrickMatthiesen/CommunityToolkit.Aspire.Hosting.Garage/releases/download/v$version/$packageName" -OutFile $downloadPath
if ((Get-FileHash -LiteralPath $downloadPath).Hash -ne $expectedHash) {
    throw 'Garage package checksum does not match the pinned release.'
}
Move-Item -LiteralPath $downloadPath -Destination $packagePath -Force
Write-Output "Restored and verified Garage integration $version."
