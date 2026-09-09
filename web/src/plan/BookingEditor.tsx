import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Booking } from "../types";
import "./BookingEditor.css";

export type BookingEditorProps = {
  initial: Booking;
  isNew: boolean;
  timeZone?: string | null;
  onClose: () => void;
  onSave: (booking: Booking) => void;
};

const STANDARD_KINDS = ["hotel", "flight", "transport", "ticket", "restaurant", "other"] as const;
const STANDARD_STATUSES = ["planned", "confirmed", "cancelled"] as const;

const kindLabel: Record<(typeof STANDARD_KINDS)[number], string> = {
  hotel: "Accommodation",
  flight: "Flight",
  transport: "Transport",
  ticket: "Ticket",
  restaurant: "Restaurant",
  other: "Other",
};

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function isCalendarDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

/** Parse ISO values without consulting the browser's local timezone. */
function parseIsoValue(value: string): number | null {
  const dateOnly = dateOnlyPattern.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isCalendarDate(year, month, day) ? Date.UTC(year, month - 1, day) : null;
  }

  const dateTime = isoDateTimePattern.exec(value);
  if (!dateTime) return null;
  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = dateTime[6] ? Number(dateTime[6]) : 0;
  const fraction = dateTime[7] ? Number(`0.${dateTime[7]}`) * 1000 : 0;
  const zone = dateTime[8];
  if (!isCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  if (zone && zone.toUpperCase() !== "Z") {
    const offset = zone.replace(":", "");
    if (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(3, 5)) > 59) return null;
  }

  if (!zone) return Date.UTC(year, month - 1, day, hour, minute, second, Math.trunc(fraction));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanBooking(booking: Booking): Booking {
  return {
    ...booking,
    kind: booking.kind.trim(),
    title: booking.title.trim(),
    status: booking.status.trim(),
    confirmationCode: optionalText(booking.confirmationCode),
    url: optionalText(booking.url),
    start: optionalText(booking.start),
    end: optionalText(booking.end),
    date: optionalText(booking.date),
    checkIn: optionalText(booking.checkIn),
    checkOut: optionalText(booking.checkOut),
    location: optionalText(booking.location),
    notes: optionalText(booking.notes),
  };
}

function addDateError(errors: string[], label: string, value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = parseIsoValue(trimmed);
  if (parsed === null) errors.push(`${label} must be an ISO date or date/time.`);
  return parsed;
}

/** Return user-facing validation errors for a booking draft. */
export function validateBooking(booking: Booking): string[] {
  const errors: string[] = [];
  const kind = booking.kind?.trim().toLowerCase();
  const status = booking.status?.trim().toLowerCase();
  if (!booking.title?.trim()) errors.push("Title is required.");
  if (!kind) errors.push("Booking type is required.");
  if (!status) errors.push("Status is required.");

  if (booking.url?.trim()) {
    try {
      const url = new URL(booking.url.trim());
      if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
        errors.push("URL must use http:// or https://.");
      }
    } catch {
      errors.push("URL must use http:// or https://.");
    }
  }

  if (kind === "hotel") {
    if (!booking.checkIn?.trim()) errors.push("Hotel check-in is required.");
    if (!booking.checkOut?.trim()) errors.push("Hotel check-out is required.");
    const checkIn = booking.checkIn?.trim();
    const checkOut = booking.checkOut?.trim();
    const checkInMatch = checkIn ? dateOnlyPattern.exec(checkIn) : null;
    const checkOutMatch = checkOut ? dateOnlyPattern.exec(checkOut) : null;
    const checkInValid = !!checkInMatch && isCalendarDate(Number(checkInMatch[1]), Number(checkInMatch[2]), Number(checkInMatch[3]));
    const checkOutValid = !!checkOutMatch && isCalendarDate(Number(checkOutMatch[1]), Number(checkOutMatch[2]), Number(checkOutMatch[3]));
    if (checkIn && !checkInValid) errors.push("Hotel check-in must be a valid date (YYYY-MM-DD).");
    if (checkOut && !checkOutValid) errors.push("Hotel check-out must be a valid date (YYYY-MM-DD).");
    if (checkInValid && checkOutValid && checkOut! <= checkIn!) errors.push("Hotel check-out must be after check-in.");
  } else {
    addDateError(errors, "Date", booking.date);
    const start = addDateError(errors, "Start", booking.start);
    const end = addDateError(errors, "End", booking.end);
    if (start !== null && end !== null && end < start) errors.push("End must be at or after Start.");
  }
  return errors;
}

function valuesForSelect(standard: readonly string[], current: string): string[] {
  return [...new Set([...standard, current].filter(Boolean))];
}

function fieldValue(value: string | null | undefined): string {
  return value ?? "";
}

function BookingTime({label,value,timeZone,onChange}:{label:string;value?:string|null;timeZone?:string|null;onChange:(value:string|null)=>void}) {
  const existingOffset = value?.match(/(Z|[+-]\d{2}:?\d{2})$/i)?.[1];
  const [offset,setOffset] = useState(existingOffset?.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") || (timeZone === "Asia/Tokyo" ? "+09:00" : ""));
  const wall = value?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/)?.[0] || "";
  return <div className="booking-time-fields"><label>{label}<input type="datetime-local" step="any" value={wall} onInput={e=>onChange(e.currentTarget.value ? e.currentTarget.value+offset : null)}/></label><label>UTC offset for {label.toLowerCase()}<input aria-label={`UTC offset for ${label.toLowerCase()}`} placeholder="+09:00" pattern="Z|[+-][0-9]{2}:[0-9]{2}" value={offset} onChange={e=>{setOffset(e.target.value);if(wall)onChange(wall+e.target.value)}}/></label></div>;
}

export default function BookingEditor({ initial, isNew, timeZone, onClose, onSave }: BookingEditorProps) {
  const [draft, setDraft] = useState<Booking>(() => ({ ...initial }));
  const [errors, setErrors] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const kinds = valuesForSelect(STANDARD_KINDS, initial.kind);
  const statuses = valuesForSelect(STANDARD_STATUSES, initial.status);
  const isHotel = draft.kind.trim().toLowerCase() === "hotel";

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const focusFrame = requestAnimationFrame(() => titleInput.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, []);

  const update = <K extends keyof Booking>(key: K, value: Booking[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors([]);
  };

  const changeKind = (kind: string) => {
    setDraft((current) => {
      if (current.kind.trim().toLowerCase() === kind.trim().toLowerCase()) return current;
      const next = { ...current, kind };
      if (kind.trim().toLowerCase() === "hotel") {
        next.start = null;
        next.end = null;
      } else {
        next.checkIn = null;
        next.checkOut = null;
      }
      return next;
    });
    setErrors([]);
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = cleanBooking(draft);
    const nextErrors = validateBooking(next);
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }
    onSave(next);
  };

  return (
    <dialog
      ref={dialog}
      className="booking-editor"
      aria-labelledby="booking-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form className="booking-editor-form" onSubmit={save} noValidate>
        <header className="booking-editor-header">
          <div>
            <h2 id="booking-editor-heading">{isNew ? "New booking" : "Edit booking"}</h2>

          </div>
          <button type="button" className="booking-editor-icon" onClick={onClose} aria-label="Close booking editor">
            <X size={19} />
          </button>
        </header>

        {errors.length > 0 && (
          <div className="booking-editor-errors" role="alert" aria-live="polite">
            <strong>Check these details</strong>
            <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </div>
        )}

        <div className="booking-editor-fields">
          <div className="booking-editor-grid booking-editor-grid-top">
            <label>
              Title
              <input ref={titleInput} required value={draft.title} onChange={(event) => update("title", event.target.value)} aria-invalid={errors.some((error) => error === "Title is required.")} />
            </label>
            <label>
              Type
              <select value={draft.kind} onChange={(event) => changeKind(event.target.value)}>
                {kinds.map((kind) => <option value={kind} key={kind}>{kindLabel[kind as keyof typeof kindLabel] ?? kind}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
                {statuses.map((status) => <option value={status} key={status}>{status === "planned" ? "Planned" : status === "confirmed" ? "Confirmed" : status === "cancelled" ? "Cancelled" : status}</option>)}
              </select>
            </label>
          </div>

          {isHotel ? (
            <div className="booking-editor-grid">
              <label>
                Check-in
                <input type="date" value={fieldValue(draft.checkIn)} onInput={(event) => update("checkIn", event.currentTarget.value || null)} aria-invalid={errors.some((error) => error.includes("check-in"))} />
              </label>
              <label>
                Check-out
                <input type="date" value={fieldValue(draft.checkOut)} onInput={(event) => update("checkOut", event.currentTarget.value || null)} aria-invalid={errors.some((error) => error.includes("check-out"))} />
              </label>
            </div>
          ) : (
            <>
              <div className="booking-editor-grid">
                <label>
                  Date
                  <input type="date" value={fieldValue(draft.date)} onInput={(event) => update("date", event.currentTarget.value || null)} />
                </label>
              </div>
              <div className="booking-editor-grid">
                <BookingTime label="Start" value={draft.start} timeZone={timeZone} onChange={value=>update("start",value)}/>
                <BookingTime label="End" value={draft.end} timeZone={timeZone} onChange={value=>update("end",value)}/>
              </div>
              <p id="booking-editor-time-help" className="booking-editor-help">Use the timezone for each departure or arrival. Japan is UTC +09:00; existing offsets are preserved.</p>
            </>
          )}

          <div className="booking-editor-grid">
            <label>
              Confirmation code
              <input value={fieldValue(draft.confirmationCode)} onChange={(event) => update("confirmationCode", event.target.value || null)} />
            </label>
            <label>
              Location
              <input value={fieldValue(draft.location)} onChange={(event) => update("location", event.target.value || null)} />
            </label>
          </div>
          <label>
            URL
            <input type="text" inputMode="url" autoComplete="url" value={fieldValue(draft.url)} onChange={(event) => update("url", event.target.value || null)} aria-invalid={errors.some((error) => error.startsWith("URL"))} />
          </label>
          <label>
            Notes
            <textarea rows={4} value={fieldValue(draft.notes)} onChange={(event) => update("notes", event.target.value || null)} />
          </label>
        </div>

        <footer className="booking-editor-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="booking-editor-primary">{isNew ? "Add booking" : "Save booking"}</button>
        </footer>
      </form>
    </dialog>
  );
}
