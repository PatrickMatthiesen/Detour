using System.ComponentModel;
using ModelContextProtocol.Server;

namespace Detour.Api;

[McpServerToolType]
public sealed class PhotoMcpTools(PlacePhotoService photos)
{
    [McpServerTool(ReadOnly = false, Destructive = true, OpenWorld = true, Idempotent = true, UseStructuredContent = true)]
    [Description("Download one public image for an existing place into private Detour storage. Read the place first and use its current trip version. imageUrl is the direct image URL; sourceUrl is the source page URL for attribution. kind is place, neighbourhood, or illustrative. Reuse the same intended operation after a conflict only with a freshly read version.")]
    public Task<PhotoOperationResult> ImportPhoto(
        [Description("Existing place ID; never use a place name.")] string placeId,
        [Description("Direct HTTP(S) URL of the image. Private, local, credential-bearing, and non-standard-port URLs are rejected.")] string imageUrl,
        [Description("HTTP(S) page where the image came from, retained for attribution.")] string? sourceUrl,
        [Description("Image author or photographer, when known.")] string? author,
        [Description("Short display caption.")] string? caption,
        [Description("One of place, neighbourhood, or illustrative.")] string? kind,
        [Description("Image license, when known.")] string? license,
        [Description("Current trip version from get_trip or a successful edit.")] long expectedVersion,
        CancellationToken cancellationToken = default)
        => photos.ImportAsync(placeId, imageUrl, sourceUrl, author, caption, kind, license, expectedVersion, cancellationToken);

    [McpServerTool(ReadOnly = false, Destructive = true, OpenWorld = false, Idempotent = true, UseStructuredContent = true)]
    [Description("Remove the photo for one existing place. This is irreversible for the stored object; read the place first and use its current trip version.")]
    public Task<PhotoOperationResult> RemovePhoto(
        [Description("Existing place ID; never use a place name.")] string placeId,
        [Description("Current trip version from get_trip or a successful edit.")] long expectedVersion,
        CancellationToken cancellationToken = default)
        => photos.RemoveAsync(placeId, expectedVersion, cancellationToken);
}
