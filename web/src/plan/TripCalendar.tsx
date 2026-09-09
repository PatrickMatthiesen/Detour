import {
  CalendarCheck2,
  Hotel,
  Ticket,
  TrainFront,
  TriangleAlert,
  Clock3,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { daySummary, datesForTrip } from "./planning";
import type { TripSnapshot } from "../types";
import "./TripCalendar.css";

export type DayIndicatorVariant = "icons" | "dots" | "labels";

export type TripCalendarProps = {
  snapshot: TripSnapshot;
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose?: () => void;
  variant?: DayIndicatorVariant;
};

type CalendarDate = {
  date: string;
  weekday: string;
  month: string;
  day: string;
  label: string;
};

type AccommodationState = "covered" | "missing" | "outside";
type IndicatorKind = "activity" | "booking" | "travel" | "hotel" | "unknown" | "overlap";

type IndicatorItem = {
  kind: IndicatorKind;
  count?: number;
  label: string;
  heading: string;
  details: string[];
  text: string;
  tone?: AccommodationState;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const datePart = (value: string | null | undefined) => {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
};

const dateInfo = (date: string): CalendarDate => {
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(value);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(value);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
  return {
    date,
    weekday,
    month,
    day,
    label: `${weekday}, ${month} ${day}`,
  };
};

const activityName = (snapshot: TripSnapshot, activity: TripSnapshot["activities"][number]) =>
  activity.title?.trim() ||
  snapshot.places.find((place) => place.id === activity.placeId)?.name ||
  "Untitled activity";

const accommodationState = (
  snapshot: TripSnapshot,
  date: string,
  covered: boolean,
): AccommodationState => {
  const arrival = datePart(snapshot.trip.arrival?.date) || snapshot.trip.startDate;
  const departure = datePart(snapshot.trip.departure?.date) || snapshot.trip.endDate;
  if (covered) return "covered";
  if (date < arrival || date >= departure) return "outside";
  return covered ? "covered" : "missing";
};

const accommodationLabel = (state: AccommodationState) => {
  if (state === "covered") return "Accommodation covered";
  if (state === "missing") return "Accommodation missing for this night";
  return "Outside accommodation nights";
};

const isAccommodationBooking = (booking: TripSnapshot["bookings"][number]) => {
  const kind = booking.kind.trim().toLowerCase();
  return kind === "hotel" || kind === "accommodation" || kind === "lodging" || kind === "hostel" ||
    kind === "ryokan" || kind === "guesthouse" || kind === "apartment" || kind === "airbnb";
};

const isConfirmed = (status: string | null | undefined) => status?.trim().toLowerCase() === "confirmed";

const localDateForTimestamp = (value: string | null | undefined, timeZone: string | null | undefined) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone?.trim() || "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
};

const formatTimestamp = (value: string | null | undefined, timeZone: string | null | undefined) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateInfo(value).label;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (!hasOffset) {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/);
    if (!match) return value;
    return `${dateInfo(match[1]).label} at ${match[2]}`;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return value;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone?.trim() || "Asia/Tokyo",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instant));
  } catch {
    return value;
  }
};

const formatDuration = (minutes: number | null | undefined) => {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

const activityDuration = (snapshot: TripSnapshot, activity: TripSnapshot["activities"][number]) => {
  if (typeof activity.durationMinutes === "number" && Number.isFinite(activity.durationMinutes) && activity.durationMinutes >= 0) {
    return activity.durationMinutes;
  }
  const place = activity.placeId ? snapshot.places.find((candidate) => candidate.id === activity.placeId) : undefined;
  return typeof place?.durationMinutes === "number" && Number.isFinite(place.durationMinutes) && place.durationMinutes >= 0
    ? place.durationMinutes
    : null;
};

const bookingDetails = (booking: TripSnapshot["bookings"][number], timeZone: string | null | undefined) => {
  const name = booking.title?.trim() || "Untitled booking";
  const metadata = [booking.kind?.trim(), booking.status?.trim()].filter(Boolean).join(" · ");
  const checkIn = formatTimestamp(booking.checkIn, timeZone);
  const checkOut = formatTimestamp(booking.checkOut, timeZone);
  const start = formatTimestamp(booking.start, timeZone);
  const end = formatTimestamp(booking.end, timeZone);
  const when = checkIn
    ? `Check-in ${checkIn}${checkOut ? ` · check-out ${checkOut}` : ""}`
    : start || end
      ? `${start || ""}${start && end ? " – " : ""}${end || ""}`
      : formatTimestamp(booking.date, timeZone);
  return `${name}${metadata ? ` · ${metadata}` : ""}${when ? ` · ${when}` : ""}`;
};

function indicatorCopy(snapshot: TripSnapshot, date: string) {
  const summary = daySummary(snapshot, date);
  const activityNames = summary.activities.map((activity) => activityName(snapshot, activity));
  const travelNames = summary.travelLegs.map((leg) => `${leg.from} to ${leg.to}`);
  const bookingNames = summary.bookings.map((booking) => booking.title || "Untitled booking");
  const state = accommodationState(snapshot, date, summary.accommodationCovered);
  const unknownNames = summary.unknownItems;
  const coveredBookings = snapshot.bookings.filter((booking) =>
    !booking.status?.toLowerCase().includes("cancel") &&
    isConfirmed(booking.status) &&
    isAccommodationBooking(booking) &&
    Boolean(booking.checkIn && booking.checkOut) &&
    (localDateForTimestamp(booking.checkIn, snapshot.trip.timeZone) || "") <= date &&
    date < (localDateForTimestamp(booking.checkOut, snapshot.trip.timeZone) || ""),
  );
  const overlapNames = summary.conflicts;

  return {
    summary,
    state,
    activityNames,
    travelNames,
    bookingNames,
    unknownNames,
    coveredBookings,
    overlapNames,
  };
}

const joinItems = (count: number, singular: string, names: string[]) => {
  const label = `${count} ${count === 1 ? singular : (singular === "activity" ? "activities" : `${singular}s`)}`;
  return names.length ? `${label}: ${names.join(", ")}` : label;
};

function DayIndicatorPopover({ item, snapshot, date }: { item: IndicatorItem; snapshot: TripSnapshot; date: string }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const rawId = useId();
  const popoverId = `trip-calendar-popover-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const headingId = `${popoverId}-heading`;

  const clearClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closePopover = useCallback(() => {
    clearClose();
    const popover = popoverRef.current as (HTMLDivElement & { hidePopover?: () => void }) | null;
    if (popover?.matches(":popover-open")) popover.hidePopover?.();
    setOpen(false);
  }, [clearClose]);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popover.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(Math.max(margin, triggerRect.left), Math.max(margin, window.innerWidth - popupRect.width - margin));
    let top = triggerRect.bottom + 8;
    if (top + popupRect.height > window.innerHeight - margin && triggerRect.top - popupRect.height - 8 >= margin) {
      top = triggerRect.top - popupRect.height - 8;
    }
    setPosition({ left, top: Math.max(margin, top) });
  }, []);

  const openPopover = useCallback(() => {
    clearClose();
    const popover = popoverRef.current as (HTMLDivElement & { showPopover?: () => void }) | null;
    if (!popover) return;
    if (!popover.matches(":popover-open")) popover.showPopover?.();
    setOpen(true);
    requestAnimationFrame(positionPopover);
  }, [clearClose, positionPopover]);

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(closePopover, 180);
  }, [clearClose, closePopover]);

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const handleToggle = () => setOpen(popover.matches(":popover-open"));
    popover.addEventListener("toggle", handleToggle);
    return () => {
      popover.removeEventListener("toggle", handleToggle);
      (popover as HTMLDivElement & { hidePopover?: () => void }).hidePopover?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => closePopover();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", positionPopover);
    const frame = requestAnimationFrame(positionPopover);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", positionPopover);
    };
  }, [closePopover, open, positionPopover]);

  useEffect(() => {
    closePopover();
  }, [closePopover, date, snapshot]);

  useEffect(() => () => clearClose(), [clearClose]);

  const Icon = {
    activity: CalendarCheck2,
    booking: Ticket,
    travel: TrainFront,
    hotel: Hotel,
    unknown: Clock3,
    overlap: TriangleAlert,
  }[item.kind];
  return (
    <>
      <span
        ref={triggerRef}
        className={`trip-calendar-indicator trip-calendar-indicator--${item.kind}${item.tone ? ` is-${item.tone}` : ""}`}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-controls={popoverId}
        aria-expanded={open}
        aria-label={item.label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); openPopover(); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPopover();
          } else if (event.key === "Escape") {
            event.preventDefault();
            closePopover();
            triggerRef.current?.focus();
          }
        }}
        onFocus={openPopover}
        onBlur={scheduleClose}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
      >
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
        {item.count !== undefined && <b aria-hidden="true">{item.count}</b>}
      </span>
      {createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          popover="auto"
          role="dialog"
          aria-labelledby={headingId}
          className="trip-calendar-popover"
          style={{ left: `${position.left}px`, top: `${position.top}px` }}
          onMouseEnter={clearClose}
          onMouseLeave={scheduleClose}
        >
          <h3 id={headingId}>{item.heading}</h3>
          <ul>{item.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>
        </div>,
        document.body,
      )}
    </>
  );
}

function IndicatorDot({
  kind,
  count,
  label,
  tone,
}: {
  kind: "activity" | "booking" | "travel" | "hotel" | "unknown" | "overlap";
  count?: number;
  label: string;
  tone?: AccommodationState;
}) {
  return (
    <span className={`trip-calendar-indicator trip-calendar-indicator--${kind}${tone ? ` is-${tone}` : ""}`} role="img" aria-label={label} title={label}>
      <i aria-hidden="true" />
      {count !== undefined && <b aria-hidden="true">{count}</b>}
    </span>
  );
}

function IndicatorLabel({
  kind,
  count,
  children,
  tone,
}: {
  kind: "activity" | "booking" | "travel" | "hotel" | "unknown" | "overlap";
  count?: number;
  children: string;
  tone?: AccommodationState;
}) {
  return (
    <span className={`trip-calendar-label trip-calendar-label--${kind}${tone ? ` is-${tone}` : ""}`}>
      {count !== undefined && <b>{count}</b>}
      <span>{children}</span>
    </span>
  );
}

export function DayIndicators({
  snapshot,
  date,
  variant = "icons",
}: {
  snapshot: TripSnapshot;
  date: string;
  variant?: DayIndicatorVariant;
}) {
  const { summary, state, activityNames, travelNames, bookingNames, unknownNames, coveredBookings, overlapNames } = indicatorCopy(snapshot, date);
  const indicators: IndicatorItem[] = [
    summary.activities.length > 0 ? {
      kind: "activity" as const,
      count: summary.activities.length,
      label: joinItems(summary.activities.length, "activity", activityNames),
      heading: "Activities",
      details: summary.activities.map((activity) => {
        const name = activityName(snapshot, activity);
        const duration = formatDuration(activityDuration(snapshot, activity));
        return `${name}${activity.startTime ? ` · ${activity.startTime}` : ""}${duration ? ` · ${duration}` : " · duration unknown"}`;
      }),
      text: summary.activities.length === 1 ? "activity" : "activities",
    } : null,
    summary.bookings.length > 0 ? {
      kind: "booking" as const,
      count: summary.bookings.length,
      label: joinItems(summary.bookings.length, "booking", bookingNames),
      heading: "Bookings",
      details: summary.bookings.map((booking) => bookingDetails(booking, snapshot.trip.timeZone)),
      text: summary.bookings.length === 1 ? "booking" : "bookings",
    } : null,
    summary.travelLegs.length > 0 ? {
      kind: "travel" as const,
      count: summary.travelLegs.length,
      label: joinItems(summary.travelLegs.length, "travel leg", travelNames),
      heading: "Travel",
      details: summary.travelLegs.map((leg) => `${leg.from} to ${leg.to}${leg.mode ? ` · ${leg.mode}` : ""}${formatDuration(leg.durationMinutes) ? ` · ${formatDuration(leg.durationMinutes)}` : " · duration unknown"}`),
      text: "travel",
    } : null,
    {
      kind: "hotel" as const,
      count: undefined,
      label: accommodationLabel(state),
      heading: state === "covered" ? "Accommodation covered" : state === "missing" ? "Accommodation missing" : "Outside accommodation nights",
      details: state === "covered"
        ? coveredBookings.map((booking) => bookingDetails(booking, snapshot.trip.timeZone))
        : state === "missing"
          ? [`No confirmed accommodation covers the night of ${dateInfo(date).label}.`]
          : ["This date is outside the trip's accommodation nights."],
      text: state === "covered" ? "hotel covered" : state === "missing" ? "hotel missing" : "no hotel night",
      tone: state,
    },
    summary.unknownDurations > 0 ? {
      kind: "unknown" as const,
      count: summary.unknownDurations,
      label: `${summary.unknownDurations} item${summary.unknownDurations === 1 ? "" : "s"} with unknown duration`,
      heading: "Unknown durations",
      details: unknownNames,
      text: "time unknown",
    } : null,
    summary.overlaps ? {
      kind: "overlap" as const,
      count: undefined,
      label: "Overlapping scheduled items",
      heading: "Overlapping items",
      details: overlapNames.length ? overlapNames : ["Scheduled items overlap."],
      text: "overlap",
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className={`trip-calendar-indicators trip-calendar-indicators--${variant}`} aria-label="Day details">
      {variant === "icons" && indicators.map((item) => (
        <DayIndicatorPopover key={item.kind} item={item} snapshot={snapshot} date={date} />
      ))}
      {variant === "dots" && indicators.map((item) => (
        <IndicatorDot key={item.kind} kind={item.kind} count={item.count} label={item.label} tone={item.tone} />
      ))}
      {variant === "labels" && indicators.map((item) => (
        <IndicatorLabel key={item.kind} kind={item.kind} count={item.count} tone={item.tone}>{item.text}</IndicatorLabel>
      ))}
    </div>
  );
}

function dayAriaLabel(snapshot: TripSnapshot, date: string) {
  const { summary, state, activityNames, travelNames, bookingNames } = indicatorCopy(snapshot, date);
  const details = [
    summary.activities.length ? joinItems(summary.activities.length, "activity", activityNames) : null,
    summary.bookings.length ? joinItems(summary.bookings.length, "booking", bookingNames) : null,
    summary.travelLegs.length ? joinItems(summary.travelLegs.length, "travel leg", travelNames) : null,
    state === "missing" ? "Accommodation missing" : state === "covered" ? "Accommodation covered" : null,
    summary.unknownDurations ? `${summary.unknownDurations} item with unknown duration` : null,
    summary.overlaps ? "Overlapping scheduled items" : null,
  ].filter(Boolean);
  return `${dateInfo(date).label}. ${details.length ? details.join(". ") : "No scheduled items."}`;
}

function CalendarContents({snapshot,date}:{snapshot:TripSnapshot;date:string}) {
  const {summary,state,activityNames,travelNames,bookingNames}=indicatorCopy(snapshot,date);
  const items=[...activityNames.map(name=>({kind:"Activity",name})),...travelNames.map(name=>({kind:"Travel",name})),...bookingNames.map(name=>({kind:"Booking",name}))];
  return <span className="trip-calendar-contents">
    <strong>{summary.cities.join(" / ") || "No city assigned"}</strong>
    {items.slice(0,3).map((item,i)=><span key={i} title={item.name}><small>{item.kind}</small>{item.name}</span>)}
    {items.length>3 && <small>+{items.length-3} more</small>}
    {state==="missing" && <em>Accommodation to arrange</em>}
    {summary.overlaps && <em>Activities overlap</em>}
  </span>;
}

export default function TripCalendar({ snapshot, selectedDate, onSelect, onClose, variant = "icons" }: TripCalendarProps) {
  const dates = useMemo(() => datesForTrip(snapshot), [snapshot]);
  const cells = useMemo(() => {
    if (!dates.length) return [] as Array<string | null>;
    const firstDay = new Date(`${dates[0]}T12:00:00Z`).getUTCDay();
    const leadingBlanks = (firstDay + 6) % 7;
    const result: Array<string | null> = [...Array.from({ length: leadingBlanks }, () => null), ...dates];
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [dates]);

  return (
    <section className="trip-calendar" aria-labelledby="trip-calendar-heading">
      <div className="trip-calendar-heading">
        <div>
          <h2 id="trip-calendar-heading">Trip calendar</h2>
          <p>Select a day to open its plan.</p>
        </div>
        <span className="trip-calendar-heading-actions">
          <span className="trip-calendar-range">
            {dates.length ? `${dateInfo(dates[0]).month} ${dateInfo(dates[0]).day} – ${dateInfo(dates[dates.length - 1]).month} ${dateInfo(dates[dates.length - 1]).day}` : "No dates set"}
          </span>
          {onClose && <button type="button" className="trip-calendar-day-view" onClick={onClose}>Day view</button>}
        </span>
      </div>

      <div className="trip-calendar-scroll">
        <div className="trip-calendar-grid-wrap">
          <div className="trip-calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="trip-calendar-grid" aria-label="Trip dates">
            {cells.map((date, index) => date ? (
              <button
                type="button"
                key={date}
                className={`trip-calendar-day${selectedDate === date ? " is-selected" : ""}`}
                aria-current={selectedDate === date ? "date" : undefined}
                aria-label={dayAriaLabel(snapshot, date)}
                onClick={() => onSelect(date)}
              >
                <span className="trip-calendar-date" aria-hidden="true">
                  <span>{dateInfo(date).weekday.slice(0, 3)}</span>
                  <strong>{dateInfo(date).day}</strong>
                  <small>{dateInfo(date).month}</small>
                </span>
                <DayIndicators snapshot={snapshot} date={date} variant={variant} />
                <CalendarContents snapshot={snapshot} date={date}/>

              </button>
            ) : (
              <span className="trip-calendar-blank" aria-hidden="true" key={`blank-${index}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
