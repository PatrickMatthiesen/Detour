import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Hotel,
  MapPin,
  Plus,
  Trash2,
  TrainFront,
  Ticket,
} from "lucide-react";
import { displayPlaces, photoFor, PlacePhoto, shortDate } from "../mockups/design-kit";
import { daySummary, datesForTrip } from "./planning";
import type { Activity, Booking, Place, TravelLeg, TripSnapshot } from "../types";
import TripCalendar, { DayIndicators } from "./TripCalendar";
import "./plan.css";
import StayEditor from "./StayEditor";
import BookingEditor from "./BookingEditor";
import BookingsPanel from "./BookingsPanel";
import TravelEditor from "./TravelEditor";
import JourneysPanel from "./JourneysPanel";
import PlaceDetails from "./PlaceDetails";

export type PlanPageProps = {
  snapshot: TripSnapshot;
  update: (fn: (s: TripSnapshot) => TripSnapshot) => void;
};

const formatDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const formatLongDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

const placeCopy = (place: Place) =>
  place.description || place.notes?.split("\n")[0] || "A saved idea waiting for a closer look.";

const hoursLabel = (minutes:number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;

const durationLabel = (minutes: number | null | undefined) =>
  minutes == null || minutes <= 0 ? "Time unknown" : `${minutes} min`;

const formatBookingSource = (source: string, timeZone?: string | null) => {
  if (!source) return "Date unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return shortDate(source);
  }
  const instant = Date.parse(source);
  if (!Number.isFinite(instant)) return source;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone || "Asia/Tokyo",
    }).format(new Date(instant));
  } catch {
    return source;
  }
};

const bookingWhen = (booking: Booking, timeZone?: string | null) => {
  if (booking.checkIn) {
    return `Check-in ${shortDate(booking.checkIn)}${booking.checkOut ? ` · check-out ${shortDate(booking.checkOut)}` : ""}`;
  }
  if (booking.start && booking.end) {
    return `${formatBookingSource(booking.start, timeZone)} – ${formatBookingSource(booking.end, timeZone)}`;
  }
  const source = booking.start || booking.date;
  return source ? formatBookingSource(source, timeZone) : "Date unknown";
};

function Commitment({ booking, timeZone, onEdit }: { booking: Booking; timeZone?: string | null; onEdit:()=>void }) {
  return (
    <div className={`plan-commitment plan-booking-${booking.kind}`}>
      <span className="plan-commitment-icon" aria-hidden="true">
        {booking.kind === "hotel" ? <Hotel size={15} /> : <Ticket size={15} />}
      </span>
      <span className="plan-commitment-copy">
        <button type="button" className="plan-booking-link" onClick={onEdit}>{booking.title}</button>
        <small>
          {booking.kind === "hotel" ? "Accommodation" : booking.kind || "Booking"}
          {booking.location ? ` · ${booking.location}` : ""}
          {booking.status ? ` · ${booking.status}` : ""}
          {` · ${bookingWhen(booking, timeZone)}`}
        </small>
      </span>
    </div>
  );
}

function ActivityRow({
  activity,
  place,
  update,
  remove,
}: {
  activity: Activity;
  place: Place | undefined;
  update: PlanPageProps["update"];
  remove: () => void;
}) {
  const [startTime, setStartTime] = useState(activity.startTime || "");
  const [duration, setDuration] = useState(
    activity.durationMinutes == null ? "" : String(activity.durationMinutes),
  );

  useEffect(() => {
    setStartTime(activity.startTime || "");
    setDuration(activity.durationMinutes == null ? "" : String(activity.durationMinutes));
  }, [activity.durationMinutes, activity.startTime]);

  const save = (patch: Partial<Activity>) =>
    update((snapshot) => ({
      ...snapshot,
      activities: snapshot.activities.map((item) =>
        item.id === activity.id ? { ...item, ...patch } : item,
      ),
    }));

  return (
    <article className="plan-activity-row">
      <span className="plan-activity-dot" aria-hidden="true"><Check size={13} /></span>
      <div className="plan-activity-main">
        <strong>{place?.name || activity.title || "Unlinked activity"}</strong>
        <span>{place?.area || place?.city || "Saved activity"}</span>
      </div>
      <label className="plan-field plan-time-field">
        <span>Starts</span>
        <input
          type="time"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
          onBlur={() => {if ((startTime || null) !== (activity.startTime || null)) save({ startTime: startTime || null });}}
          aria-label={`Start time for ${place?.name || activity.title || "activity"}`}
        />
      </label>
      <label className="plan-field plan-duration-field">
        <span>Minutes</span>
        <input
          type="number"
          min="1"
          inputMode="numeric"
          placeholder="Unknown"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          onBlur={() => {
            const value = duration.trim() ? Number(duration) : null;
            save({ durationMinutes: Number.isInteger(value) && value && value > 0 ? value : null });
          }}
          aria-label={`Duration for ${place?.name || activity.title || "activity"}`}
        />
      </label>
      <button type="button" className="plan-icon-button plan-remove" onClick={remove} aria-label={`Remove ${place?.name || activity.title || "activity"}`}>
        <Trash2 size={15} />
      </button>
    </article>
  );
}

export default function PlanPage({ snapshot, update }: PlanPageProps) {
  const dates = useMemo(() => datesForTrip(snapshot), [snapshot]);
  const arrivalDate = snapshot.trip.arrival?.date?.slice(0, 10) || snapshot.trip.arrival?.localDateTime?.slice(0, 10);
  const firstStayDate = snapshot.stays[0]?.checkIn?.slice(0, 10);
  const preferredDate = arrivalDate || firstStayDate || dates[0] || "";
  const [focusedDate, setFocusedDate] = useState(preferredDate);
  const [journeysOpen,setJourneysOpen] = useState(false);
  const [travelDraft,setTravelDraft] = useState<{leg:TravelLeg,isNew:boolean}|null>(null);
  const [detailPlace,setDetailPlace] = useState<Place|null>(null);
  const [bookingsOpen,setBookingsOpen] = useState(false);
  const [bookingDraft,setBookingDraft] = useState<{booking:Booking,isNew:boolean}|null>(null);
  const onAddAccommodation = (date?:string,city?:string)=>{
    const end=date ? new Date(date+"T12:00:00Z") : null;
    if(end)end.setUTCDate(end.getUTCDate()+1);
    setBookingDraft({isNew:true,booking:{id:crypto.randomUUID(),title:"",kind:date?"hotel":"ticket",status:"planned",location:city||null,checkIn:date||null,checkOut:end?.toISOString().slice(0,10)||null}});
  };
  const [stayEditor,setStayEditor] = useState<{id?:string}|null>(null);
  const [calendarOpen,setCalendarOpen] = useState(false);
  const [showAllStays, setShowAllStays] = useState(false);
  const [placeCity, setPlaceCity] = useState<string | null>(null);

  useEffect(() => {
    if (focusedDate && dates.includes(focusedDate)) return;
    setFocusedDate(dates.includes(preferredDate) ? preferredDate : dates[0] || "");
  }, [dates, focusedDate, preferredDate]);

  const index = Math.max(0, dates.indexOf(focusedDate));
  const date = dates[index] || focusedDate;
  useEffect(() => {
    if (!date) return;
    document.querySelector<HTMLElement>(`[data-plan-date="${date}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [date]);

  const summary = useMemo(() => daySummary(snapshot, date), [date, snapshot]);
  const currentStays = useMemo(
    () => snapshot.stays.filter((stay) => date >= stay.checkIn && date < stay.checkOut),
    [date, snapshot.stays],
  );
  const cities = useMemo(() => {
    const fromStays = snapshot.stays.map((stay) => stay.city).filter(Boolean);
    const fromPlaces = snapshot.places.map((place) => place.city).filter(Boolean);
    return [...new Set([...fromStays, ...fromPlaces])];
  }, [snapshot.places, snapshot.stays]);
  const shownCities = summary.cities.length ? summary.cities : cities;
  const selectedPlaces = useMemo(() => {
    const activeCity = placeCity && shownCities.includes(placeCity) ? placeCity : null;
    const allowed = activeCity ? [activeCity] : shownCities;
    return displayPlaces(snapshot.places)
      .filter((place) => allowed.length === 0 || allowed.includes(place.city))
      .sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)));
  }, [placeCity, shownCities, snapshot.places]);
  const scheduledIds = useMemo(
    () => new Set(summary.activities.map((activity) => activity.placeId).filter(Boolean)),
    [summary.activities],
  );
  const dateBookings = summary.bookings;

  const addToDay = (place: Place) => {
    if (!date || scheduledIds.has(place.id)) return;
    update((current) => {
      if (current.activities.some((activity) => activity.date === date && activity.placeId === place.id && activity.status !== "cancelled")) {
        return current;
      }
      return {
        ...current,
        places: current.places.map((item) => item.id === place.id ? { ...item, selected: true } : item),
        activities: [
          ...current.activities,
          {
            id: crypto.randomUUID(),
            placeId: place.id,
            date,
            startTime: null,
            durationMinutes: place.durationMinutes ?? null,
            status: "planned",
          },
        ],
      };
    });
  };

  const removeActivity = (id: string) =>
    update((current) => ({ ...current, activities: current.activities.filter((activity) => activity.id !== id) }));

  const shiftDate = (offset: number) => {
    const next = dates[index + offset];
    if (next) setFocusedDate(next);
  };

  return (
    <main className={`plan-page${calendarOpen ? " calendar-open" : ""}`}>
      <section className={`plan-stays${showAllStays ? " is-expanded" : ""}`} aria-label="City stays">
        <div className="plan-stays-label"><span>Cities</span><button className="plan-toggle-stays" aria-expanded={showAllStays} onClick={()=>setShowAllStays(value=>!value)}>{showAllStays ? "Collapse" : `${currentStays[0]?.city || "View route"} ▾`}</button></div>
        <div className="plan-stay-list">
          {snapshot.stays.length ? [...snapshot.stays].sort((a,b)=>a.checkIn.localeCompare(b.checkIn)).map((stay) => (
            <button
              type="button"
              key={stay.id}
              className={`plan-stay${currentStays.some((current) => current.id === stay.id) ? " is-current" : ""}`}
              onClick={() => {
                setStayEditor({id:stay.id});
              }}
            >
              <strong>{stay.city}</strong>
              <span>{shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}</span>

            </button>
          )) : <button type="button" className="plan-calendar-switch" onClick={()=>setStayEditor({})}><Plus size={15}/> Add city</button>}
        </div>
      </section>

      {calendarOpen ? <TripCalendar snapshot={snapshot} selectedDate={date} onClose={()=>setCalendarOpen(false)} onSelect={next=>{setFocusedDate(next);setCalendarOpen(false)}}/> : <>
      <section className="plan-date-nav" aria-label="Trip dates">
        <button type="button" className="plan-icon-button" onClick={() => shiftDate(-1)} disabled={index === 0} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <div className="plan-date-list">
          {dates.slice(Math.max(0, Math.min(index - 3, dates.length - 7)), Math.max(0, Math.min(index - 3, dates.length - 7)) + 7).map((item) => (
            <button type="button" key={item} data-plan-date={item} aria-label={shortDate(item)} className={`plan-date${item === date ? " is-active" : ""}`} onClick={() => setFocusedDate(item)} aria-current={item === date ? "date" : undefined}>
              <span>{formatDay(item)}</span>
              <strong>{new Date(`${item}T12:00:00Z`).getUTCDate()}</strong>
              <DayIndicators snapshot={snapshot} date={item}/>
            </button>
          ))}
        </div>
        <button type="button" className="plan-icon-button" onClick={() => shiftDate(1)} disabled={index === dates.length - 1 || !dates.length} aria-label="Next day"><ChevronRight size={18} /></button>
        <button type="button" className="plan-calendar-switch" onClick={()=>setCalendarOpen(true)} aria-label="Whole trip" title="Whole trip calendar"><CalendarDays size={18}/><span>Whole trip</span></button>
      </section>

      <div className="plan-layout">
        <section className="plan-day-column" aria-labelledby="focused-day-heading">
          <div className="plan-day-heading">
            <div className="plan-day-title">
              <h1 id="focused-day-heading">{date ? formatLongDay(date) : "Choose a day"}</h1>
              <p>{summary.cities.length ? summary.cities.join(" · ") : "No city stay assigned"}</p>
            </div>
            <div className={`plan-capacity${summary.knownMinutes > 720 ? " is-over" : ""}`} title="Known bookings and activities within 09:00–21:00, plus unscheduled visit and journey durations.">
              <strong>{summary.knownMinutes > 720 ? `+${summary.knownMinutes - 720} min` : `Up to ${hoursLabel(summary.remainingMinutes)}`}</strong>
              <span>{summary.knownMinutes > 720 ? "over the 09:00–21:00 window" : "unallocated · 09:00–21:00"}</span>
            </div>
          </div>

          <div className="plan-commitments">
            <div className="plan-section-head"><span>Commitments</span><div className="plan-commitment-tools"><button type="button" className="plan-booking-link" onClick={()=>setJourneysOpen(true)}>Journeys</button><button type="button" className="plan-booking-link" onClick={()=>setBookingsOpen(true)}>Bookings</button></div></div>
            {currentStays.map((stay) => <div className="plan-commitment plan-stay-commitment" key={stay.id}><span className="plan-commitment-icon"><Hotel size={15} /></span><span className="plan-commitment-copy"><strong>{stay.name || `Stay in ${stay.city}`}</strong><small>Planned stay · {stay.city}</small></span></div>)}
            {summary.travelLegs.map((leg) => <div className="plan-commitment plan-travel-commitment" key={leg.id}><span className="plan-commitment-icon"><TrainFront size={15} /></span><span className="plan-commitment-copy"><button type="button" className="plan-booking-link" onClick={()=>setTravelDraft({leg,isNew:false})}>{leg.from} → {leg.to}</button><small>{leg.mode || "Travel"} · {durationLabel(leg.durationMinutes)}{leg.estimated ? " · estimated" : ""}</small></span></div>)}
            {dateBookings.map((booking) => <Commitment booking={booking} timeZone={snapshot.trip.timeZone} onEdit={()=>setBookingDraft({booking,isNew:false})} key={booking.id} />)}
            {(summary.accommodationCovered || (date >= (snapshot.trip.arrival?.date || snapshot.trip.startDate) && date < (snapshot.trip.departure?.date || snapshot.trip.endDate))) && <p className={`plan-lodging-status${summary.accommodationCovered ? " is-covered" : ""}`}>
              <Hotel size={13} /> {summary.accommodationCovered ? "Confirmed accommodation covers this night" : `No confirmed accommodation for the night of ${shortDate(date)}`}
              {!summary.accommodationCovered && onAddAccommodation && <button type="button" onClick={()=>onAddAccommodation(date,currentStays[0]?.city || summary.cities[0] || "")}>Add accommodation</button>}
            </p>}
            {!currentStays.length && !summary.travelLegs.length && !dateBookings.length && <p className="plan-empty">Nothing committed for this day yet.</p>}
          </div>

          <div className="plan-activities">
            <div className="plan-section-head"><span>Activities</span><small>{summary.activities.length} planned</small></div>
            {summary.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} place={snapshot.places.find((place) => place.id === activity.placeId)} update={update} remove={() => removeActivity(activity.id)} />)}
            {!summary.activities.length && <p className="plan-empty">Add a saved place to begin shaping this day.</p>}
            {summary.overlaps&&<p className="plan-conflict" role="status">Overlapping: {summary.conflicts.join(", ")}</p>}
            <details className="plan-time-details"><summary><Clock3 size={13}/> Time estimate{summary.unknownDurations ? ` · ${summary.unknownDurations} durations unknown` : ""}</summary><p>Uses the 09:00–21:00 planning window. Meals and unrecorded local travel still need room.</p>{summary.calculationNotes.map((note,index)=><p key={index}>{note}</p>)}</details>
          </div>
        </section>

        <aside className="plan-places-column" aria-labelledby="saved-places-heading">
          <div className="plan-places-heading">
            <div><h2 id="saved-places-heading">Add to this day</h2></div>
            <span className="plan-place-count">{selectedPlaces.length}</span>
          </div>
          <div className="plan-city-filter" role="tablist" aria-label="Saved place city">
            <button type="button" role="tab" className={!placeCity ? "is-active" : ""} onClick={() => setPlaceCity(null)} aria-selected={!placeCity}>All cities</button>
            {shownCities.map((cityName) => <button type="button" role="tab" key={cityName} className={placeCity === cityName ? "is-active" : ""} onClick={() => setPlaceCity(cityName)} aria-selected={placeCity === cityName}>{cityName}</button>)}
          </div>
          <div className="plan-place-list">
            {selectedPlaces.map((place) => {
              const scheduled = scheduledIds.has(place.id);
              return <article className={`plan-place-row${place.selected ? " is-selected" : ""}${photoFor(place).photo?.url ? "" : " no-photo"}`} key={place.id}>
                {photoFor(place).photo?.url && <PlacePhoto place={place} className="plan-place-photo" />}
                <div className="plan-place-copy">
                  <div className="plan-place-title"><button type="button" className="plan-place-detail-link" onClick={()=>setDetailPlace(place)}>{place.name}</button><button type="button" className={`plan-add-icon${scheduled ? " is-added" : ""}`} aria-label={scheduled ? `Remove ${place.name} from ${shortDate(date)}` : `Add ${place.name} to ${shortDate(date)}`} title={scheduled ? "Remove from this day" : "Add to this day"} aria-pressed={scheduled} onClick={()=>scheduled ? update(current=>({...current,activities:current.activities.filter(activity=>!(activity.placeId===place.id && activity.date===date && activity.status!=="cancelled"))})) : addToDay(place)}>{scheduled ? <Check size={18}/> : <Plus size={18}/>}</button></div>
                  <span className="plan-place-meta"><MapPin size={12} />{place.city}{place.area ? ` · ${place.area}` : ""} · {durationLabel(place.durationMinutes)}</span>
                  <p>{placeCopy(place)}</p>

                </div>
              </article>;
            })}
            {!selectedPlaces.length && <p className="plan-empty">No saved places in this city yet.</p>}
          </div>
        </aside>
      </div>
      </>}
      {stayEditor && <StayEditor snapshot={snapshot} initialId={stayEditor.id} onClose={()=>setStayEditor(null)} onSave={stays=>{update(current=>({...current,stays}));setStayEditor(null);}}/>}
      {bookingsOpen && <BookingsPanel snapshot={snapshot} onClose={()=>setBookingsOpen(false)} onEdit={booking=>setBookingDraft({booking,isNew:false})} onAdd={onAddAccommodation}/>}
      {bookingDraft && <BookingEditor initial={bookingDraft.booking} isNew={bookingDraft.isNew} timeZone={snapshot.trip.timeZone} onClose={()=>setBookingDraft(null)} onSave={booking=>{update(current=>({...current,bookings:bookingDraft.isNew ? [...current.bookings,booking] : current.bookings.map(b=>b.id===booking.id?booking:b)}));setBookingDraft(null);}}/>}
      {journeysOpen&&<JourneysPanel legs={snapshot.travelLegs} onClose={()=>setJourneysOpen(false)} onEdit={leg=>setTravelDraft({leg,isNew:false})} onAdd={()=>setTravelDraft({isNew:true,leg:{id:crypto.randomUUID(),date,from:summary.cities[0]||"",to:"",mode:"train",durationMinutes:null,estimated:true}})}/>}
      {travelDraft&&<TravelEditor initial={travelDraft.leg} isNew={travelDraft.isNew} onClose={()=>setTravelDraft(null)} onSave={leg=>{update(current=>({...current,travelLegs:travelDraft.isNew?[...current.travelLegs,leg]:current.travelLegs.map(l=>l.id===leg.id?leg:l)}));setTravelDraft(null);}} onRemove={travelDraft.isNew?undefined:()=>{update(current=>({...current,travelLegs:current.travelLegs.filter(l=>l.id!==travelDraft.leg.id)}));setTravelDraft(null);}}/>}
      {detailPlace&&<PlaceDetails place={detailPlace} scheduled={scheduledIds.has(detailPlace.id)} onClose={()=>setDetailPlace(null)} onAdd={()=>addToDay(detailPlace)}/>}
    </main>
  );
}
