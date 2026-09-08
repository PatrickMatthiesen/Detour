using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;

namespace Detour.Api;

[McpServerToolType]
public sealed class TripMcpTools(TripService service)
{
    [McpServerTool, Description("Read the current owner's complete trip snapshot, including saved places, stays, travel, activities, bookings, tasks, and packing items.")]
    public async Task<string> GetTrip(CancellationToken cancellationToken = default)
        => JsonSerializer.Serialize(await service.GetSnapshotAsync(cancellationToken), JsonOptions);

    [McpServerTool, Description("Search places already saved in the current owner's trip. Search before adding to avoid duplicates.")]
    public async Task<string> SearchPlaces(string? query = null, string? city = null, CancellationToken cancellationToken = default)
        => JsonSerializer.Serialize(await service.SearchPlacesAsync(query, city, cancellationToken), JsonOptions);

    [McpServerTool, Description("Save or update one place in the current owner's library. Preserve the source URL. Requires the latest version from get_trip.")]
    public async Task<string> SavePlace(Place place, long expectedVersion, CancellationToken cancellationToken = default)
        => SerializeResult(await service.SavePlaceAsync(place, expectedVersion, cancellationToken));

    [McpServerTool, Description("Save or update a booking found in the current owner's email. Requires the latest version from get_trip.")]
    public async Task<string> UpdateBooking(Booking booking, long expectedVersion, CancellationToken cancellationToken = default)
        => SerializeResult(await service.UpdateBookingAsync(booking, expectedVersion, cancellationToken));

    [McpServerTool, Description("Apply a deliberate full trip edit for the current owner. Requires the latest version to prevent overwriting concurrent edits.")]
    public async Task<string> ReplaceTrip(TripSnapshot snapshot, long expectedVersion, CancellationToken cancellationToken = default)
        => SerializeResult(await service.ReplaceAsync(snapshot, expectedVersion, cancellationToken));

    private static string SerializeResult(ReplaceResult result) => result switch
    {
        ReplaceResult.Success success => JsonSerializer.Serialize(new { success = true, snapshot = success.Snapshot }, JsonOptions),
        ReplaceResult.Conflict conflict => JsonSerializer.Serialize(new { success = false, conflict = true, snapshot = conflict.Snapshot }, JsonOptions),
        ReplaceResult.Invalid => JsonSerializer.Serialize(new { success = false, error = "invalid_trip" }, JsonOptions),
        _ => JsonSerializer.Serialize(new { success = false, error = "unknown" }, JsonOptions)
    };

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
