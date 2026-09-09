import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TravelLeg } from "../types";
import "./TravelEditor.css";

export type TravelEditorProps = {
  initial: TravelLeg;
  isNew: boolean;
  onClose: () => void;
  onSave: (leg: TravelLeg) => void;
  onRemove?: () => void;
};

const COMMON_MODES = ["train", "flight", "bus", "car", "ferry", "walk", "other"];
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

/** Return user-facing validation errors for a travel leg draft. */
export function validateTravel(leg: TravelLeg): string[] {
  const errors: string[] = [];
  if (!leg.from?.trim()) errors.push("Origin is required.");
  if (!leg.to?.trim()) errors.push("Destination is required.");

  const date = leg.date?.trim();
  if (!date) errors.push("Date is required.");
  else if (!isCalendarDate(date)) errors.push("Date must be a valid date (YYYY-MM-DD).");

  if (leg.durationMinutes !== null && leg.durationMinutes !== undefined
    && (!Number.isInteger(leg.durationMinutes) || leg.durationMinutes <= 0)) {
    errors.push("Duration must be a positive whole number of minutes.");
  }
  return errors;
}

function optionalMode(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function cleanTravel(leg: TravelLeg): TravelLeg {
  return {
    ...leg,
    from: leg.from.trim(),
    to: leg.to.trim(),
    date: leg.date.trim(),
    mode: leg.mode === undefined || leg.mode === null ? leg.mode : optionalMode(leg.mode),
    estimated: Boolean(leg.estimated),
  };
}

function durationValue(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export default function TravelEditor({ initial, isNew, onClose, onSave, onRemove }: TravelEditorProps) {
  const [draft, setDraft] = useState<TravelLeg>(() => ({
    ...initial,
    mode: initial.mode ?? (isNew ? "train" : null),
    estimated: initial.estimated ?? true,
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fromInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() => fromInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, []);

  const update = <K extends keyof TravelLeg>(key: K, value: TravelLeg[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors([]);
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = cleanTravel(draft);
    const nextErrors = validateTravel(next);
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }
    onSave(next);
  };

  return (
    <dialog
      ref={dialog}
      className="travel-editor"
      aria-labelledby="travel-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form className="travel-editor-form" onSubmit={save} noValidate>
        <header className="travel-editor-header">
          <h2 id="travel-editor-heading">{isNew ? "New journey" : "Edit journey"}</h2>
          <button type="button" className="travel-editor-icon" onClick={onClose} aria-label="Close journey editor">
            <X size={19} />
          </button>
        </header>

        {errors.length > 0 && (
          <div className="travel-editor-errors" role="alert" aria-live="polite">
            <strong>Check these details</strong>
            <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </div>
        )}

        {confirmRemove ? (
          <section className="travel-editor-confirm" aria-labelledby="travel-remove-heading">
            <h3 id="travel-remove-heading">Remove journey?</h3>
            <p>This removes the journey from your plan. Any bookings stay unchanged.</p>
            <div className="travel-editor-confirm-actions">
              <button type="button" onClick={() => setConfirmRemove(false)}>Back</button>
              <button type="button" className="travel-editor-danger" onClick={onRemove}>Remove</button>
            </div>
          </section>
        ) : (
          <div className="travel-editor-fields">
            <div className="travel-editor-grid">
              <label>
                From
                <input ref={fromInput} required value={draft.from} onChange={(event) => update("from", event.target.value)} aria-invalid={errors.some((error) => error === "Origin is required.")} />
              </label>
              <label>
                To
                <input required value={draft.to} onChange={(event) => update("to", event.target.value)} aria-invalid={errors.some((error) => error === "Destination is required.")} />
              </label>
            </div>

            <div className="travel-editor-grid">
              <label>
                Date
                <input type="date" required value={draft.date} onInput={(event) => update("date", event.currentTarget.value)} aria-invalid={errors.some((error) => error.startsWith("Date"))} />
              </label>
              <label>
                Mode <span className="travel-editor-optional">(optional)</span>
                <input list="travel-mode-options" value={draft.mode ?? ""} onChange={(event) => update("mode", event.target.value || null)} />
                <datalist id="travel-mode-options">
                  {COMMON_MODES.map((mode) => <option value={mode} key={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
                </datalist>
              </label>
            </div>

            <div className="travel-editor-grid travel-editor-grid-bottom">
              <label>
                Duration (minutes) <span className="travel-editor-optional">(optional)</span>
                <input type="number" min="1" step="1" inputMode="numeric" placeholder="Unknown" value={durationValue(draft.durationMinutes)} onInput={(event) => update("durationMinutes", event.currentTarget.value ? Number(event.currentTarget.value) : null)} aria-invalid={errors.some((error) => error.startsWith("Duration"))} />
              </label>
              <label className="travel-editor-check">
                <input type="checkbox" checked={draft.estimated ?? false} onChange={(event) => update("estimated", event.target.checked)} />
                <span>Estimated duration</span>
              </label>
            </div>

            {!isNew && onRemove && (
              <button type="button" className="travel-editor-remove" onClick={() => setConfirmRemove(true)}>Remove journey</button>
            )}
          </div>
        )}

        <footer className="travel-editor-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          {!confirmRemove && <button type="submit" className="travel-editor-primary">{isNew ? "Add journey" : "Save journey"}</button>}
        </footer>
      </form>
    </dialog>
  );
}
