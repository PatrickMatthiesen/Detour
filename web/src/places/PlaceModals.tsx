import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Place } from "../types";

export const uid = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function AddPlaceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (place: Place) => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Tokyo");
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("Sightseeing");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: uid("place"),
      name: name.trim(),
      city: city.trim() || "Unknown city",
      area: area.trim(),
      category,
      notes: notes.trim(),
      description: notes.trim(),
      sourceUrl: sourceUrl.trim() || null,
      priority: "nice",
      status: "Candidate",
      needsResearch: true,
      selected: false,
    });
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="overline">NEW LIBRARY ENTRY</span>
            <h2>Add a place</h2>
            <p>Keep the idea loose. You can decide where it fits later.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. teamLab Borderless"
              required
            />
          </label>
          <label>
            City
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Tokyo"
            />
          </label>
          <label>
            Area / neighborhood
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Azabudai"
            />
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option>Sightseeing</option>
              <option>Food</option>
              <option>Culture</option>
              <option>Nature</option>
              <option>Shopping</option>
              <option>Activity</option>
            </select>
          </label>
          <label className="span-2">
            Source URL
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why did you save this?"
              rows={3}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Plus size={17} /> Save place
          </button>
        </div>
      </form>
    </div>
  );
}

export function EditPlaceModal({
  place,
  onClose,
  onSave,
  embedded = false,
}: {
  place: Place;
  onClose: () => void;
  onSave: (place: Place) => void;
  embedded?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!embedded) dialog.current?.showModal();
  }, [embedded]);
  const [draft, setDraft] = useState(place);
  const set = <K extends keyof Place>(key: K, value: Place[K]) =>
    setDraft((current) => ({ ...current, [key]: value,
      ...(key === "latitude" || key === "longitude" ? { coordinatesFromGoogle: false } : {}),
    }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const durationIsValid =
      draft.durationMinutes == null ||
      (Number.isFinite(draft.durationMinutes) && draft.durationMinutes >= 1);
    const coordinatesAreValid =
      (draft.latitude == null ||
        (Number.isFinite(draft.latitude) && draft.latitude >= -90 && draft.latitude <= 90)) &&
      (draft.longitude == null ||
        (Number.isFinite(draft.longitude) && draft.longitude >= -180 && draft.longitude <= 180));

    if (draft.name.trim() && durationIsValid && coordinatesAreValid)
      onSave({
        ...draft,
        name: draft.name.trim(),
        city: draft.city.trim() || "Unknown city",
        resolveCoordinates: (draft.latitude == null || draft.longitude == null) && !!draft.googleMapsUrl?.trim(),
      });
  };
  const form = (
    <form className="modal edit-place-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="overline">LIBRARY ENTRY</span>
            <h2 id="edit-place-heading">Edit place</h2>
            <p>Correct the facts without losing the original source.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={embedded ? "Back" : "Close"}
          >
            {embedded ? <><span aria-hidden="true">←</span> Back</> : <X size={18} />}
          </button>
        </div>
        <div className="form-grid">
          <div className="edit-form-section span-2" role="heading" aria-level={3}>
            Place details
          </div>
          <label>
            Name
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </label>
          <label>
            City
            <input
              value={draft.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </label>
          <label>
            Area / neighborhood
            <input
              value={draft.area || ""}
              onChange={(e) => set("area", e.target.value)}
            />
          </label>
          <label>
            Category
            <input
              value={draft.category || ""}
              onChange={(e) => set("category", e.target.value)}
              placeholder="Sightseeing, Food"
            />
          </label>
          <label className="span-2">
            Description
            <textarea
              value={draft.description || ""}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="What makes this place worth considering?"
            />
          </label>
          <div className="edit-form-section span-2" role="heading" aria-level={3}>
            Visit planning
          </div>
          <label>
            Visit minutes
            <input
              type="number"
              min="1"
              step="1"
              value={draft.durationMinutes ?? ""}
              onChange={(e) =>
                set(
                  "durationMinutes",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              placeholder="Unknown"
            />
          </label>
          <label>
            Duration text
            <input
              value={draft.durationText || ""}
              onChange={(e) => set("durationText", e.target.value)}
              placeholder="e.g. 45–90 min"
            />
          </label>
          <label>
            Opening hours
            <input
              value={draft.openingHours || ""}
              onChange={(e) => set("openingHours", e.target.value)}
              placeholder="e.g. 10:00–18:00"
            />
          </label>
          <label>
            Reservation
            <input
              value={draft.reservation || ""}
              onChange={(e) => set("reservation", e.target.value)}
              placeholder="Unknown, recommended, required"
            />
          </label>
          <label>
            Status
            <input
              value={draft.status || ""}
              onChange={(e) => set("status", e.target.value)}
              placeholder="Candidate"
            />
          </label>
          <label>
            Priority
            <select
              value={draft.priority || "none"}
              onChange={(e) => set("priority", e.target.value as Place["priority"])}
            >
              <option value="required">Must visit</option>
              <option value="high">High</option>
              <option value="nice">Nice to visit</option>
              <option value="none">None</option>
            </select>
          </label>
          <label
            style={{ flexDirection: "row", alignItems: "center", paddingTop: 22 }}
          >
            <input
              type="checkbox"
              checked={!!draft.needsResearch}
              onChange={(e) => set("needsResearch", e.target.checked)}
              style={{ width: 16, height: 16, padding: 0, accentColor: "#b9422e" }}
            />
            Needs research
          </label>
          <label
            style={{ flexDirection: "row", alignItems: "center", paddingTop: 22 }}
          >
            <input
              type="checkbox"
              checked={!!draft.selected}
              onChange={(e) => set("selected", e.target.checked)}
              style={{ width: 16, height: 16, padding: 0, accentColor: "#b9422e" }}
            />
            Chosen for trip
          </label>
          <div className="edit-form-section span-2" role="heading" aria-level={3}>
            Location and links
          </div>
          <label>
            Latitude
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              value={draft.latitude ?? ""}
              onChange={(e) =>
                set("latitude", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Unknown"
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              value={draft.longitude ?? ""}
              onChange={(e) =>
                set("longitude", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Unknown"
            />
          </label>
          <label className="span-2">
            Source URL
            <input
              value={draft.sourceUrl || ""}
              onChange={(e) => set("sourceUrl", e.target.value)}
              type="url"
            />
          </label>
          <label className="span-2">
            Google Maps URL
            <input
              value={draft.googleMapsUrl || ""}
              onChange={(e) => set("googleMapsUrl", e.target.value)}
              placeholder="https://www.google.com/maps/…"
            />
            {(draft.latitude == null || draft.longitude == null) && draft.googleMapsUrl?.trim()
              ? <small>Saving will look up the missing coordinates. You can save again to retry a failed lookup.</small>
              : null}
          </label>
          <label className="span-2">
            Instagram URL
            <input
              value={draft.instagramUrl || ""}
              onChange={(e) => set("instagramUrl", e.target.value)}
              type="url"
              placeholder="https://www.instagram.com/..."
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={draft.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={17} /> Save changes
          </button>
        </div>
    </form>
  );
  if (embedded) {
    return (
      <section className="edit-place-embedded" aria-labelledby="edit-place-heading">
        {form}
      </section>
    );
  }
  return (
    <dialog ref={dialog} className="edit-place-dialog" aria-labelledby="edit-place-heading" onCancel={onClose}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {form}
    </dialog>
  );
}
