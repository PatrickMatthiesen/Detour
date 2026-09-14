using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Detour.Api;

[JsonConverter(typeof(JsonStringEnumConverter<BulkEditMode>))]
public enum BulkEditMode { atomic, best_effort }
[JsonConverter(typeof(JsonStringEnumConverter<PhotoFailurePolicy>))]
public enum PhotoFailurePolicy { fail_operation, save_without_new_photo }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PlaceEditOperation(EditOperation Operation, string Id, PlaceChanges? Changes = null, string[]? ClearFields = null);
public sealed record EditDiagnostic(string Code, string Message, IReadOnlyList<LocationCandidate>? Candidates = null);
public sealed record PlaceEditOutcome(int Index, string Id, string Status, Place? Item = null, EditDiagnostic? Error = null, EditDiagnostic? PhotoError = null);
public sealed record BulkPlaceResult(bool Success, long Version, bool Committed, IReadOnlyList<PlaceEditOutcome> Results, string? Error = null, string? Message = null);

internal sealed class BulkPreparation(BulkEditMode mode, PhotoFailurePolicy photoPolicy, List<PlaceEditOutcome> results)
{
    public BulkEditMode Mode => mode;
    public PhotoFailurePolicy PhotoPolicy => photoPolicy;
    public List<PlaceEditOutcome> Results => results;
    public void Fail(string id, EditDiagnostic error)
    {
        var index = results.FindIndex(x => x.Id == id);
        results[index] = results[index] with { Status = "failed", Error = error };
    }
    public void Warn(string id, EditDiagnostic error)
    {
        var index = results.FindIndex(x => x.Id == id);
        results[index] = results[index] with { PhotoError = error };
    }
}

public sealed class BulkPlaceEditor(TripService service)
{
    public async Task<BulkPlaceResult> EditAsync(long version, PlaceEditOperation[] operations, BulkEditMode mode,
        PhotoFailurePolicy photoPolicy, CancellationToken ct = default)
    {
        var snapshot = await service.GetSnapshotAsync(ct);
        if (operations is null || operations.Length is < 1 or > 50 || operations.Any(x => x is null || string.IsNullOrWhiteSpace(x.Id))
            || operations.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() != operations.Length
            || !Enum.IsDefined(mode) || !Enum.IsDefined(photoPolicy))
            return new(false, snapshot.Version, false, [], "invalid_batch", "Supply 1–50 operations with unique non-empty IDs and valid mode and photoFailurePolicy values.");
        var results = operations.Select((op, i) => new PlaceEditOutcome(i, op.Id, "pending")).ToList();
        if (snapshot.Version != version)
            return new(false, snapshot.Version, false, results.Select(x => x with { Status = "not_committed", Item = snapshot.Places.Find(p => p.Id == x.Id) }).ToArray(), "version_conflict");
        var batch = new BulkPreparation(mode, photoPolicy, results);
        foreach (var op in operations)
        {
            var existing = snapshot.Places.Find(x => x.Id == op.Id);
            var code = "invalid_operation";
            string? error = !Enum.IsDefined(op.Operation) ? "Unknown operation." : null;
            if (op.Operation == EditOperation.create && existing is not null) { code = "already_exists"; error = "Place already exists. Use update."; }
            if (op.Operation != EditOperation.create && existing is null) { code = "not_found"; error = "Place was not found."; }
            var patch = op.Changes is null ? new JsonObject() : JsonSerializer.SerializeToNode(op.Changes, TripMcpTools.PatchOptions)!.AsObject();
            try { PlacePatch.NormalizeGooglePlaceId(patch); }
            catch (ArgumentException ex) { error = ex.Message; }
            foreach (var field in op.ClearFields ?? [])
            {
                if (string.IsNullOrWhiteSpace(field) || patch.ContainsKey(field)) { error = "Use a field only once, in changes or clearFields."; break; }
                patch[field] = null;
            }
            if (op.Operation == EditOperation.delete)
            {
                if (patch.Count > 0) error = "Delete does not accept changes.";
                if (existing is not null && error is null) { error = TripItemEditor.GetDeleteReferenceError(snapshot, existing); code = "referenced"; }
                if (error is null) snapshot.Places.Remove(existing!);
            }
            else if (error is null)
            {
                var applied = TripItemEditor.TryApplyPatch(existing ?? new Place(), op.Id, patch);
                error = applied.Error;
                code = "invalid_changes";
                if (error is null)
                {
                    var edited = applied.Item!;
                    edited.GoogleMapsUrl = GoogleMapsCoordinates.NormalizeUrl(edited.GoogleMapsUrl);
                    edited.ResolveCoordinates = !GoogleMapsCoordinates.IsValid(edited.Latitude, edited.Longitude) && !string.IsNullOrWhiteSpace(edited.GoogleMapsUrl);
                    if (patch.ContainsKey("latitude") || patch.ContainsKey("longitude")) edited.CoordinatesFromGoogle = false;
                    code = "validation_failed";
                    error = TripItemEditor.ValidateEditedItem(snapshot, edited, existing is null, patch);
                    if (error is null)
                    {
                        if (existing is null) snapshot.Places.Add(edited);
                        else snapshot.Places[snapshot.Places.IndexOf(existing)] = edited;
                    }
                }
            }
            if (error is not null) batch.Fail(op.Id, new(code, error));
        }
        if (mode == BulkEditMode.atomic && results.Any(x => x.Status == "failed"))
            return Finish(false, version, false, null, "batch_failed");
        if (results.All(x => x.Status == "failed")) return Finish(false, version, false, null, "batch_failed");
        var saved = await service.ReplaceBatchAsync(snapshot, version, batch, ct);
        return saved switch
        {
            ReplaceResult.Success ok => Finish(true, ok.Snapshot.Version, true, ok.Snapshot, null),
            ReplaceResult.Conflict conflict => Finish(false, conflict.Snapshot.Version, false, conflict.Snapshot, "version_conflict"),
            ReplaceResult.Invalid invalid => Finish(false, version, false, null, "batch_failed", invalid.Message),
            _ => Finish(false, version, false, null, "batch_failed")
        };

        BulkPlaceResult Finish(bool success, long newVersion, bool committed, TripSnapshot? canonical, string? error, string? message = null)
        {
            var outcomes = results.Select(x => x with
            {
                Status = x.Status == "failed" ? "failed" : committed ? (x.PhotoError is null ? "succeeded" : "succeeded_with_warning") : "not_committed",
                Item = canonical?.Places.Find(p => p.Id == x.Id)
            }).ToArray();
            return new(success && outcomes.All(x => x.Status == "succeeded"), newVersion, committed, outcomes, error, message);
        }
    }
}

internal static class PlacePatch
{
    public static void NormalizeGooglePlaceId(JsonObject patch)
    {
        if (!patch.Remove("googlePlaceId", out var node) || node is null) return;
        if (patch.ContainsKey("googleMapsUrl") || patch.ContainsKey("latitude") || patch.ContainsKey("longitude"))
            throw new ArgumentException("Supply googlePlaceId alone as the location, without googleMapsUrl or coordinates.");
        var id = node.GetValue<string>();
        if (string.IsNullOrWhiteSpace(id) || id.Length > 500) throw new ArgumentException("A valid Google Place ID is required.");
        patch["googleMapsUrl"] = "https://www.google.com/maps/search/?api=1&query=place&query_place_id=" + Uri.EscapeDataString(id);
    }
}
