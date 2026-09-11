# Private place photos

Garage stores image bytes in the `detour-place-photos` bucket. PostgreSQL stores the owner/place association and attribution separately from the trip JSON. `edit_place` applies place fields and photo changes together under the same optimistic version check. Image access checks the authenticated owner and current photo ID; neither Garage's S3 endpoint nor its admin endpoint is published on a host port in production.

## Agent workflow

1. Read/search the place and its current trip version through MCP.
2. Find a suitable, lawfully published image using the agent's research tools. Detour does not run a built-in search service. Keep the source page URL and known author/license. Don't fabricate a match; use `neighbourhood` or `illustrative` for a contextual image.
3. Call `edit_place` with the place ID, expected version, and `changes.photo`: `{"url":"https://example.org/image.jpg","sourceUrl":"https://example.org/source","author":"Known photographer","caption":"Short caption","kind":"place","license":"Known license"}`. The optional fields may be omitted. The edit replaces the existing photo only after the new image and the complete place edit have been validated.
4. Omit `changes.photo` to preserve the current photo. Set `changes.photo` to `null`, or include `"photo"` in `clearFields`, to remove it. Do not use both forms in one edit. On a version conflict, re-read and reassess. Refresh the trip in the frontend after agent changes.

Image imports accept public HTTP(S) sources, validate redirects/DNS, limit download size, decode and resize the image, and store a JPEG. `edit_place` can create or update the place and import its photo atomically; a failed download, validation, or version check leaves both unchanged. A source that blocks downloading may need another source or an authenticated file upload. The app does not bypass access controls.

## Importing saved files

`POST /api/places/{id}/photo/upload` accepts multipart `file`, `expectedVersion`, `sourceUrl`, `author`, `caption`, `kind`, and `license`. It uses the same processing/storage as remote imports. Browser cookie requests require the normal CSRF token; bearer requests use the existing trip API scope.

For one-time migration, create a private JSON manifest outside source control:

```json
[
  {
    "placeId": "existing-place-id",
    "file": "photos/example.jpg",
    "sourceUrl": "https://example.org/photo-source",
    "author": "Known photographer",
    "caption": "Neighbourhood around the place",
    "kind": "neighbourhood",
    "license": "Known license, if any"
  }
]
```

Run `./scripts/import-place-photos.ps1 -ApiUrl <API URL> -ManifestPath <manifest>`. On production, supply an authorized bearer token through `DETOUR_PHOTO_IMPORT_TOKEN`; never put the token in the manifest or source code. Loopback development uses the existing local development authentication policy. The importer skips places with photos and stops on a conflict/error. It does not create or match places by name.

The prototype photos were backed up locally before removal from the current source tree. Import those files with their original attribution, and retain that backup until the migration is verified. Existing Git history is unchanged.

## Persistence and deployment

The production Garage volume is `detour-garage-data`; back it up alongside PostgreSQL. Keep all four Garage secret parameters stable across deployments: `garage-rpc-secret`, `garage-admin-token`, `garage-access-key-id`, `garage-secret-access-key`. Do not replace the volume or regenerate credentials on redeploy. The provisioner is idempotent and refuses to rotate an existing key unexpectedly. Default Garage storage is single-node, without replicated redundancy.

Removing a photo or deleting its place immediately removes access through the API. Obsolete objects are queued transactionally and deleted by a background worker, with retries if Garage is unavailable. Interrupted uploads are eligible for cleanup after one hour; active photo references are checked before any queued deletion. Imports normalize to JPEG, keep only the first animation frame, correct orientation, and remove EXIF, XMP, and IPTC metadata.
