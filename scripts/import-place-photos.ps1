param(
    [Parameter(Mandatory)][uri]$ApiUrl,
    [Parameter(Mandatory)][string]$ManifestPath
)
$ErrorActionPreference = 'Stop'
if ($ApiUrl.Scheme -notin @('http', 'https') -or $ApiUrl.UserInfo) { throw 'Use an HTTP(S) API URL without credentials.' }
$baseUrl = $ApiUrl.AbsoluteUri.TrimEnd('/')
$manifestFile = Get-Item -LiteralPath $ManifestPath
$entries = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
$headers = @{}
if ($env:DETOUR_PHOTO_IMPORT_TOKEN) { $headers.Authorization = "Bearer $env:DETOUR_PHOTO_IMPORT_TOKEN" }
$trip = Invoke-RestMethod "$baseUrl/api/trip" -Headers $headers
foreach ($entry in $entries) {
    $place = $trip.places | Where-Object id -CEQ $entry.placeId
    if (-not $place) { throw "Place $($entry.placeId) is not in this trip; nothing was imported for it." }
    if ($place.photo) { Write-Output "Skipped $($place.name): already has a photo."; continue }
    $file = Get-Item -LiteralPath ([IO.Path]::GetFullPath($entry.file, $manifestFile.DirectoryName))
    $form = @{
        file = $file
        expectedVersion = [string]$trip.version
        sourceUrl = [string]$entry.sourceUrl
        author = [string]$entry.author
        caption = [string]$entry.caption
        kind = [string]$entry.kind
        license = [string]$entry.license
    }
    $id = [uri]::EscapeDataString($entry.placeId)
    $result = Invoke-RestMethod "$baseUrl/api/places/$id/photo/upload" -Method Post -Headers $headers -Form $form
    if (-not $result.success) { throw "Import stopped for $($place.name): $($result.error). Re-read the trip before retrying." }
    Write-Output "Imported photo for $($place.name)."
    $trip = Invoke-RestMethod "$baseUrl/api/trip" -Headers $headers
}
