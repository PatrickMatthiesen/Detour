import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Activity, ActivityKind, Place } from "../types";
import { EditingNotice, MutationButton, useTripEditing } from "../trip-editing";
import "./ActivityEditor.css";

const kinds: { value: ActivityKind; label: string }[] = [
  { value: "activity", label: "Activity" },
  { value: "check-in", label: "Check-in" },
  { value: "check-out", label: "Check-out" },
  { value: "departure", label: "Departure" },
  { value: "task", label: "Task" },
];
const reminderPresets = [0, 5, 10, 15, 30, 60, 1440, 10080];

export default function ActivityEditor({ initial, places, isNew, onClose, onSave }: {
  initial: Activity;
  places: Place[];
  isNew: boolean;
  onClose: () => void;
  onSave: (activity: Activity) => void;
}) {
  const { canEdit } = useTripEditing();
  const [draft, setDraft] = useState<Activity>({ kind: "activity", reminderMinutes: null, ...initial });
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const frame = requestAnimationFrame(() => titleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const set = <K extends keyof Activity>(key: K, value: Activity[K]) => setDraft(current => ({ ...current, [key]: value }));
  const customReminder = draft.reminderMinutes != null && !reminderPresets.includes(draft.reminderMinutes);
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const title = draft.title?.trim() || "";
    if (!draft.placeId && !title) { setError("Add a title or link a saved place."); return; }
    const dateParts = draft.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const validDate = dateParts && new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))).toISOString().slice(0, 10) === draft.date;
    if (!validDate) { setError("Enter a valid event date."); return; }
    const url = draft.googleMapsUrl?.trim() || "";
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      } catch { setError("Maps link must be an http or https URL."); return; }
    }
    const minutes = draft.durationMinutes;
    const reminder = draft.reminderMinutes == null ? null : Number(draft.reminderMinutes);
    if (minutes != null && (!Number.isInteger(minutes) || minutes < 1)) { setError("Duration must be a positive number of minutes."); return; }
    if (reminder !== null && (!Number.isInteger(reminder) || reminder < 0 || reminder > 40320)) { setError("Reminder must be between 0 and 40320 minutes."); return; }
    onSave({
      ...draft,
      title: title || null,
      placeId: draft.placeId || null,
      startTime: draft.startTime || null,
      durationMinutes: minutes == null ? null : Number(minutes),
      location: draft.location?.trim() || null,
      googleMapsUrl: url || null,
      notes: draft.notes?.trim() || "",
      reminderMinutes: reminder,
      kind: draft.kind || "activity",
    });
  };

  return <dialog ref={dialog} className="activity-editor" aria-labelledby="activity-editor-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={save} noValidate>
      <header className="activity-editor-header"><h2 id="activity-editor-heading">{isNew ? "Add trip event" : "Edit trip event"}</h2><button type="button" aria-label="Close event editor" onClick={onClose}><X size={19}/></button></header>
      <EditingNotice />
      {error && <p className="activity-editor-error" role="alert">{error}</p>}
      <fieldset className="activity-editor-fields" disabled={!canEdit}>
        <div className="activity-editor-grid">
          <label>Title<input ref={titleInput} value={draft.title || ""} onChange={event => set("title", event.target.value)} placeholder="e.g. Visit the museum"/></label>
          <label>Type<select value={draft.kind || "activity"} onChange={event => set("kind", event.target.value as ActivityKind)}>{kinds.map(kind => <option value={kind.value} key={kind.value}>{kind.label}</option>)}</select></label>
        </div>
        <label>Saved place <span className="activity-editor-optional">optional</span><select value={draft.placeId || ""} onChange={event => set("placeId", event.target.value || null)}><option value="">No linked place</option>{places.map(place => <option key={place.id} value={place.id}>{place.name} · {place.city}</option>)}</select></label>
        <div className="activity-editor-grid activity-editor-time-grid">
          <label>Date<input type="date" required value={draft.date} onChange={event => set("date", event.target.value)}/></label>
          <label>Start time <span className="activity-editor-optional">optional</span><input type="time" value={draft.startTime || ""} onChange={event => set("startTime", event.target.value || null)}/></label>
          <label>Duration in minutes <span className="activity-editor-optional">optional</span><input type="number" min="1" step="1" value={draft.durationMinutes ?? ""} onChange={event => set("durationMinutes", event.target.value ? Number(event.target.value) : null)}/></label>
        </div>
        <label>Location <span className="activity-editor-optional">optional</span><input value={draft.location || ""} onChange={event => set("location", event.target.value)} placeholder="Address, station, or meeting point"/></label>
        <label>Google Maps link <span className="activity-editor-optional">optional</span><input type="url" value={draft.googleMapsUrl || ""} onChange={event => set("googleMapsUrl", event.target.value)} placeholder="https://maps.google.com/…"/></label>
        <div className="activity-editor-grid">
          <label>Reminder<select value={draft.reminderMinutes == null ? "off" : String(draft.reminderMinutes)} onChange={event => set("reminderMinutes", event.target.value === "off" ? null : Number(event.target.value))}><option value="off">Off</option>{customReminder && <option value={draft.reminderMinutes!}>{draft.reminderMinutes} minutes before</option>}<option value="0">At start</option><option value="5">5 minutes before</option><option value="10">10 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option><option value="10080">1 week before</option></select></label>
          <p className="activity-editor-help">Set any start time yourself. Detour does not add a schedule automatically.</p>
        </div>
        <label>Notes <span className="activity-editor-optional">optional</span><textarea rows={3} value={draft.notes || ""} onChange={event => set("notes", event.target.value)}/></label>
      </fieldset>
      <footer className="activity-editor-footer"><button type="button" onClick={onClose}>Cancel</button><MutationButton className="activity-editor-primary" type="submit">Save event</MutationButton></footer>
    </form>
  </dialog>;
}
