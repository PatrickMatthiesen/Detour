using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Detour.Api;

public sealed record ItemEditResult(bool Success, long Version, string? Error, string? Message, object? Item);

public sealed class TripItemEditor(TripService service)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ItemEditResult> EditAsync(
        string collection,
        string operation,
        string id,
        JsonObject? changes,
        long expectedVersion,
        CancellationToken cancellationToken = default)
    {
        var current = await service.GetSnapshotAsync(cancellationToken);

        if (!IsKnownCollection(collection))
            return Failure(current.Version, "invalid_collection", $"Unknown collection '{collection}'. Use places, bookings, tasks, packingItems, activities, stays, or travelLegs.");
        if (operation is not ("create" or "update" or "delete"))
            return Failure(current.Version, "invalid_operation", $"Unknown operation '{operation}'. Use create, update, or delete.");
        if (string.IsNullOrWhiteSpace(id))
            return Failure(current.Version, "invalid_id", "A non-empty caller-supplied id is required.");

        if (current.Version != expectedVersion)
            return Failure(
                current.Version,
                "version_conflict",
                $"The trip changed since version {expectedVersion}. Re-read version {current.Version} and reassess the edit.",
                FindItem(current, collection, id));

        if (operation == "delete" && changes is { Count: > 0 })
            return Failure(current.Version, "invalid_changes", "Delete does not accept changes. Pass an empty object or omit changes.");

        return collection switch
        {
            "places" => await EditCollectionAsync(current, current.Places, operation, id, changes, expectedVersion, cancellationToken),
            "bookings" => await EditCollectionAsync(current, current.Bookings, operation, id, changes, expectedVersion, cancellationToken),
            "tasks" => await EditCollectionAsync(current, current.Tasks, operation, id, changes, expectedVersion, cancellationToken),
            "packingItems" => await EditCollectionAsync(current, current.PackingItems, operation, id, changes, expectedVersion, cancellationToken),
            "activities" => await EditCollectionAsync(current, current.Activities, operation, id, changes, expectedVersion, cancellationToken),
            "stays" => await EditCollectionAsync(current, current.Stays, operation, id, changes, expectedVersion, cancellationToken),
            "travelLegs" => await EditCollectionAsync(current, current.TravelLegs, operation, id, changes, expectedVersion, cancellationToken),
            _ => throw new UnreachableException()
        };
    }

    private async Task<ItemEditResult> EditCollectionAsync<T>(
        TripSnapshot snapshot,
        List<T> items,
        string operation,
        string id,
        JsonObject? changes,
        long expectedVersion,
        CancellationToken cancellationToken)
        where T : class, new()
    {
        var idProperty = typeof(T).GetProperty(nameof(Place.Id))!;
        var existing = items.FirstOrDefault(item => string.Equals((string?)idProperty.GetValue(item), id, StringComparison.Ordinal));

        if (operation == "create" && existing is not null)
            return Failure(snapshot.Version, "already_exists", $"{typeof(T).Name} '{id}' already exists. Use update to change it.", existing);
        if (operation is "update" or "delete" && existing is null)
            return Failure(snapshot.Version, "not_found", $"{typeof(T).Name} '{id}' was not found.");

        if (operation == "delete")
        {
            var referenceError = GetDeleteReferenceError(snapshot, existing!);
            if (referenceError is not null)
                return Failure(snapshot.Version, "referenced", referenceError, existing);

            items.Remove(existing!);
            return await PersistAsync(snapshot, collectionItem: existing, typeof(T), id, expectedVersion, cancellationToken);
        }

        var patchResult = TryApplyPatch(existing ?? new T(), id, changes);
        if (patchResult.Error is not null)
            return Failure(snapshot.Version, "invalid_changes", patchResult.Error);

        var edited = patchResult.Item!;
        if (edited is Place locationPlace)
        {
            locationPlace.GoogleMapsUrl = GoogleMapsCoordinates.NormalizeUrl(locationPlace.GoogleMapsUrl);
            locationPlace.ResolveCoordinates = !GoogleMapsCoordinates.IsValid(locationPlace.Latitude, locationPlace.Longitude)
                && !string.IsNullOrWhiteSpace(locationPlace.GoogleMapsUrl);
        }
        if (edited is Place editedPlace && changes is not null
            && (changes.ContainsKey("latitude") || changes.ContainsKey("longitude")))
            editedPlace.CoordinatesFromGoogle = false;
        var validationError = ValidateEditedItem(snapshot, edited, operation == "create", changes);
        if (validationError is not null)
            return Failure(snapshot.Version, "validation_failed", validationError);

        if (existing is null) items.Add(edited);
        else items[items.IndexOf(existing)] = edited;

        return await PersistAsync(snapshot, edited, typeof(T), id, expectedVersion, cancellationToken);
    }

    private async Task<ItemEditResult> PersistAsync(
        TripSnapshot snapshot,
        object? collectionItem,
        Type itemType,
        string id,
        long expectedVersion,
        CancellationToken cancellationToken)
    {
        var result = await service.ReplaceAsync(snapshot, expectedVersion, cancellationToken);
        return result switch
        {
            ReplaceResult.Success success => new ItemEditResult(true, success.Snapshot.Version, null, null, FindItem(success.Snapshot, itemType, id) ?? collectionItem),
            ReplaceResult.PhotoFailed failed => Failure(expectedVersion, "photo_import_failed", failed.Message),
            ReplaceResult.Conflict conflict => Failure(
                conflict.Snapshot.Version,
                "version_conflict",
                $"The trip changed while saving. Re-read version {conflict.Snapshot.Version} and reassess the edit.",
                FindItem(conflict.Snapshot, itemType, id)),
            ReplaceResult.Invalid invalid => Failure(snapshot.Version, "validation_failed", invalid.Message ?? "The edited item failed trip validation. Check its dates, durations, coordinates, and URLs."),
            _ => throw new UnreachableException()
        };
    }

    private static (T? Item, string? Error) TryApplyPatch<T>(T source, string id, JsonObject? changes) where T : class
    {
        try
        {
            var properties = typeof(T).GetProperties(BindingFlags.Instance | BindingFlags.Public)
                .Where(property => property.CanRead && property.SetMethod?.IsPublic == true && property.GetCustomAttribute<JsonIgnoreAttribute>() is null)
                .ToDictionary(GetJsonName, StringComparer.Ordinal);
            var json = JsonSerializer.SerializeToNode(source, typeof(T), JsonOptions)?.AsObject() ?? new JsonObject();

            foreach (var change in changes ?? new JsonObject())
            {
                if (!properties.TryGetValue(change.Key, out var property))
                    return (null, $"Unknown or incorrectly cased property '{change.Key}' for {typeof(T).Name}.");

                if (change.Key == "id")
                {
                    if (change.Value is not JsonValue value || !value.TryGetValue<string>(out var suppliedId) || suppliedId != id)
                        return (null, "The id in changes must exactly match the caller-supplied id.");
                    continue;
                }

                if (change.Value is null && !IsNullable(property))
                    return (null, $"Property '{change.Key}' cannot be null.");

                json[change.Key] = change.Value?.DeepClone();
            }

            json["id"] = id;
            var edited = json.Deserialize<T>(JsonOptions);
            if (edited is null)
                return (null, $"Changes could not be converted to {typeof(T).Name}.");
            if (!string.Equals((string?)properties["id"].GetValue(edited), id, StringComparison.Ordinal))
                return (null, "The item id cannot be changed.");
            return (edited, null);
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or NotSupportedException or FormatException)
        {
            return (null, $"A supplied value has the wrong type or format for {typeof(T).Name}: {exception.Message}");
        }
    }

    private static string? ValidateEditedItem(TripSnapshot snapshot, object item, bool isCreate, JsonObject? changes)
    {
        switch (item)
        {
            case Place place:
                if (string.IsNullOrWhiteSpace(place.Name)) return "Place name is required.";
                if (string.IsNullOrWhiteSpace(place.City)) return "Place city is required.";
                if (place.Latitude is < -90 or > 90 || place.Longitude is < -180 or > 180) return "Place coordinates are outside the valid latitude or longitude range.";
                if (place.DurationMinutes is <= 0) return "Place durationMinutes must be positive when supplied.";
                if (!IsHttpUrl(place.SourceUrl)) return "Place sourceUrl must be an http or https URL when supplied.";
                if (!IsHttpUrl(place.GoogleMapsUrl)) return "Place googleMapsUrl must be an http or https URL when supplied.";
                break;
            case Stay stay:
                if (string.IsNullOrWhiteSpace(stay.City)) return "Stay city is required.";
                if (stay.CheckIn == default || stay.CheckOut == default) return "Stay checkIn and checkOut are required.";
                if (stay.CheckOut < stay.CheckIn) return "Stay checkOut must not precede checkIn.";
                if (!string.IsNullOrWhiteSpace(stay.BookingId) && !snapshot.Bookings.Any(x => x.Id == stay.BookingId))
                    return $"Stay bookingId '{stay.BookingId}' does not identify an existing booking.";
                break;
            case Activity activity:
                if (string.IsNullOrWhiteSpace(activity.PlaceId) && string.IsNullOrWhiteSpace(activity.Title))
                    return "Activity title is required when placeId is not supplied.";
                if (activity.Date == default) return "Activity date is required.";
                if (!string.IsNullOrWhiteSpace(activity.PlaceId) && !snapshot.Places.Any(x => x.Id == activity.PlaceId))
                    return $"Activity placeId '{activity.PlaceId}' does not identify an existing place.";
                if (activity.DurationMinutes is <= 0) return "Activity durationMinutes must be positive when supplied.";
                break;
            case TravelLeg leg:
                if (string.IsNullOrWhiteSpace(leg.From) || string.IsNullOrWhiteSpace(leg.To)) return "Travel leg from and to are required.";
                if (leg.Date == default) return "Travel leg date is required.";
                if (leg.DurationMinutes is <= 0) return "Travel leg durationMinutes must be positive when supplied.";
                break;
            case Booking booking:
                if (string.IsNullOrWhiteSpace(booking.Title)) return "Booking title is required.";
                if (booking.Start is not null && booking.End is not null && booking.End < booking.Start) return "Booking end must not precede start.";
                if (booking.CheckIn is not null && booking.CheckOut is not null && booking.CheckOut < booking.CheckIn) return "Booking checkOut must not precede checkIn.";
                if (!IsHttpUrl(booking.Url)) return "Booking url must be an http or https URL when supplied.";
                break;
            case TripTask task:
                if (string.IsNullOrWhiteSpace(task.Title)) return "Task title is required.";
                if ((isCreate || changes?.ContainsKey("scope") == true) && task.Scope is not ("before" or "during"))
                    return "Task scope must be 'before' or 'during'. Existing legacy scopes may remain only when scope is omitted from an update.";
                break;
            case PackingItem packingItem:
                if (string.IsNullOrWhiteSpace(packingItem.Name)) return "Packing item name is required.";
                if (packingItem.Quantity <= 0) return "Packing item quantity must be positive.";
                break;
        }

        return null;
    }

    private static string? GetDeleteReferenceError(TripSnapshot snapshot, object item) => item switch
    {
        Place place when snapshot.Activities.FirstOrDefault(activity => activity.PlaceId == place.Id) is { } activity
            => $"Place '{place.Id}' is referenced by activity '{activity.Id}'. Update or delete that activity first.",
        Booking booking when snapshot.Stays.FirstOrDefault(stay => stay.BookingId == booking.Id) is { } stay
            => $"Booking '{booking.Id}' is referenced by stay '{stay.Id}'. Update or delete that stay first.",
        _ => null
    };

    private static object? FindItem(TripSnapshot snapshot, string collection, string id) => collection switch
    {
        "places" => snapshot.Places.FirstOrDefault(x => x.Id == id),
        "bookings" => snapshot.Bookings.FirstOrDefault(x => x.Id == id),
        "tasks" => snapshot.Tasks.FirstOrDefault(x => x.Id == id),
        "packingItems" => snapshot.PackingItems.FirstOrDefault(x => x.Id == id),
        "activities" => snapshot.Activities.FirstOrDefault(x => x.Id == id),
        "stays" => snapshot.Stays.FirstOrDefault(x => x.Id == id),
        "travelLegs" => snapshot.TravelLegs.FirstOrDefault(x => x.Id == id),
        _ => null
    };

    private static object? FindItem(TripSnapshot snapshot, Type itemType, string id)
    {
        if (itemType == typeof(Place)) return snapshot.Places.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(Booking)) return snapshot.Bookings.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(TripTask)) return snapshot.Tasks.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(PackingItem)) return snapshot.PackingItems.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(Activity)) return snapshot.Activities.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(Stay)) return snapshot.Stays.FirstOrDefault(x => x.Id == id);
        if (itemType == typeof(TravelLeg)) return snapshot.TravelLegs.FirstOrDefault(x => x.Id == id);
        return null;
    }

    private static bool IsKnownCollection(string collection) => collection is "places" or "bookings" or "tasks" or "packingItems" or "activities" or "stays" or "travelLegs";

    private static string GetJsonName(PropertyInfo property) =>
        property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
        ?? JsonOptions.PropertyNamingPolicy?.ConvertName(property.Name)
        ?? property.Name;

    private static bool IsNullable(PropertyInfo property) =>
        Nullable.GetUnderlyingType(property.PropertyType) is not null
        || (!property.PropertyType.IsValueType && new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable);

    private static bool IsHttpUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";
    }

    private static ItemEditResult Failure(long version, string error, string message, object? item = null) =>
        new(false, version, error, message, item);
}
