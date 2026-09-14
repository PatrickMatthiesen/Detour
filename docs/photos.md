# Private place photos

Garage stores image bytes in the `detour-place-photos` bucket. PostgreSQL stores the owner/place association and attribution separately from the trip JSON. `edit_place` applies place fields and photo changes together under the same optimistic version check. Image access checks the authenticated owner and current photo ID; neither Garage's S3 endpoint nor its admin endpoint is published on a host port in production.

## Agent workflow

1. Read/search the place and its current trip version through MCP.
2. When adding or enriching a stop without a photo, use available research tools to find an image that best represents the experience: the place itself, its food, the activity, or another relevant subject. Import the chosen image rather than leaving the photo step out. Detour does not run a built-in search service. Preserve existing photos unless asked to replace them, and respect requests to skip photos. Keep the source page URL and known author/license. Use `place` for the actual place or its food/activity, `neighbourhood` for the surrounding area, and `illustrative` for a representative example. Never present an example as the actual place or invent image URLs or attribution. If research is unavailable, no suitable image is found, or import fails, save the stop without a photo and tell the user which stop still needs one.
3. Call `edit_place` with the place ID, expected version, and `changes.photo`: `{"url":"https://example.org/image.jpg","sourceUrl":"https://example.org/source","author":"Known photographer","caption":"Short caption","kind":"place","license":"Known license"}`. The optional fields may be omitted. The edit replaces the existing photo only after the new image and the complete place edit have been validated.
   To attach only a photo to an existing place, use `operation: "update"` and supply only `changes.photo`; other place fields are preserved.
4. Omit `changes.photo` to preserve the current photo. Set `changes.photo` to `null`, or include `"photo"` in `clearFields`, to remove it. Do not use both forms in one edit. On a version conflict, re-read and reassess. Refresh the trip in the frontend after agent changes.

Image imports accept public HTTP(S) sources, validate redirects/DNS, limit download size, decode and resize the image, and store a JPEG. `edit_place` can create or update the place and import its photo atomically; a failed download, validation, or version check leaves both unchanged. A source that blocks downloading may need another source or an authenticated file upload. The app does not bypass access controls.

For multi-place edits, `edit_places` supports atomic or best-effort batches and an independent `photoFailurePolicy`. With `save_without_new_photo`, valid fields save and a failed new photo leaves the existing photo unchanged. Inspect each `photoError` and retry with a photo-only update. With the default `fail_operation`, the entire affected place operation fails. See [bulk edits and retry semantics](mcp-tools.md#edit-multiple-places).

Import errors include structured diagnostics such as `http_403`, `unsupported_content_type`, `too_large`, `invalid_image`, `download_failed`, `timeout`, and `storage_unavailable`. No raw upstream response bodies or storage credentials are exposed.

## Importing saved files

`POST /api/places/{id}/photo/upload` accepts multipart `file`, `expectedVersion`, `sourceUrl`, `author`, `caption`, `kind`, and `license`. It uses the same processing/storage as remote imports. Browser cookie requests require the normal CSRF token; bearer requests use the existing trip API scope.

One-time migration tooling and backups stay outside source control. Existing Git history is unchanged.

## Persistence and deployment

The production Garage volume is `detour-garage-data`; back it up alongside PostgreSQL. Keep all four Garage secret parameters stable across deployments: `garage-rpc-secret`, `garage-admin-token`, `garage-access-key-id`, `garage-secret-access-key`. Do not replace the volume or regenerate credentials on redeploy. The provisioner is idempotent and refuses to rotate an existing key unexpectedly. Default Garage storage is single-node, without replicated redundancy.

Removing a photo or deleting its place immediately removes access through the API. Obsolete objects are queued transactionally and deleted by a background worker, with retries if Garage is unavailable. Interrupted uploads are eligible for cleanup after one hour; active photo references are checked before any queued deletion. Imports normalize to JPEG, keep only the first animation frame, correct orientation, and remove EXIF, XMP, and IPTC metadata.
