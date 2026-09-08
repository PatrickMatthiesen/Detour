import { useMemo, useState } from "react";
import { BedDouble, Check, ChevronRight, ExternalLink, X } from "lucide-react";
import type { Place, Stay } from "../types";
import { DesignMap, PlacePhoto, PreviewNav, cityPlaces, shortDate, useDesignTrip } from "./design-kit";
import "./seven.css";

function nights(stay: Stay) {
  const start = new Date(`${stay.checkIn}T12:00:00`).getTime();
  const end = new Date(`${stay.checkOut}T12:00:00`).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function description(place: Place) {
  return place.description || place.notes || "Description not captured yet.";
}

function ConceptSeven() {
  const { trip, selected, toggle, loading, error } = useDesignTrip();
  const [selectedStayId, setSelectedStayId] = useState("");
  const [focusedPlace, setFocusedPlace] = useState<Place | null>(null);

  const stays = trip?.stays ?? [];
  const selectedStay = stays.find((stay) => stay.id === selectedStayId) || stays[0];
  const browseCity = selectedStay?.city || trip?.places[0]?.city || "";
  const places = useMemo(() => trip ? cityPlaces(trip, browseCity) : [], [browseCity, trip]);
  const chosenPlaces = useMemo(() => places.filter((place) => selected.has(place.id)), [places, selected]);
  const citySelected = useMemo(() => trip?.places.filter((place) => place.city === browseCity && selected.has(place.id)).length ?? 0, [browseCity, selected, trip]);
  const linkedBooking = selectedStay?.bookingId ? trip?.bookings.find((booking) => booking.id === selectedStay.bookingId) : undefined;

  const chooseStay = (stay: Stay) => setSelectedStayId(stay.id);

  if (loading || !trip) {
    return <main className="new-preview d7-page"><div className="d7-loading">{error ? <><strong>Trip data unavailable</strong><span>{error}</span></> : <span>Loading route plan…</span>}</div></main>;
  }

  return (
    <main className="new-preview d7-page">
      <PreviewNav active={7} />

      <section className="d7-stay-strip" aria-label="Choose a city stay">
        <div className="d7-strip-label"><BedDouble size={16} /><span>Stays in this trip</span></div>
        <div className="d7-stay-tabs">
          {stays.map((stay) => <button className={`d7-stay-tab ${stay.id === selectedStay?.id ? "d7-active" : ""}`} key={stay.id} onClick={() => chooseStay(stay)}><strong>{stay.city}</strong><span>{shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}</span></button>)}
        </div>
      </section>

      {selectedStay && <section className="d7-stay-summary" aria-label={`${selectedStay.city} stay details`}>
        <div className="d7-stay-summary-title"><span className="d7-stay-context">Current stay</span><h2>{selectedStay.name || `${selectedStay.city} accommodation`}</h2></div>
        <div className="d7-stay-fact"><span>Dates</span><strong>{shortDate(selectedStay.checkIn)} – {shortDate(selectedStay.checkOut)}</strong></div>
        <div className="d7-stay-fact"><span>Nights</span><strong>{nights(selectedStay)}</strong></div>
        <div className="d7-stay-fact"><span>Booking</span><strong className={linkedBooking?.status === "confirmed" ? "d7-confirmed" : ""}>{linkedBooking?.status || "No linked booking"}</strong></div>
      </section>}

      <div className="d7-content">
        <section className="d7-place-column" aria-label={`${browseCity} saved places`}>
          <div className="d7-section-heading"><h2>{browseCity || "City"} · {places.length} places</h2><span className="d7-selection-count">{citySelected} chosen</span></div>
          <div className="d7-place-list">
            {places.length ? places.map((place) => {
              const isChosen = selected.has(place.id);
              return <article className={`d7-place-card ${isChosen ? "d7-chosen" : ""}`} key={place.id}>
                <button className="d7-place-image-button" onClick={() => setFocusedPlace(place)} aria-label={`View details for ${place.name}`}><PlacePhoto place={place} className="d7-place-photo" /></button>
                <div className="d7-place-main"><span className="d7-place-category">{place.category || "PLACE"}</span><h3>{place.name}</h3><p>{description(place)}</p><span className="d7-place-area">{place.area || place.city}</span></div>
                <div className="d7-place-actions"><button className="d7-choose-button" onClick={() => toggle(place.id)} aria-pressed={isChosen}>{isChosen ? <><Check size={14} /> Chosen</> : "Choose"}</button>{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in Google Maps`}><ExternalLink size={14} /></a>}</div>
              </article>;
            }) : <div className="d7-empty">No saved places are attached to this city.</div>}
          </div>
        </section>

        <aside className="d7-side-column" aria-label={`${browseCity} map and chosen places`}>
          <section className="d7-map-box"><DesignMap places={trip.places} selected={selected} city={browseCity} onCity={(city) => { const stay = stays.find((item) => item.city === city); if (stay) chooseStay(stay); }} onPlace={setFocusedPlace} className="d7-map" route /></section>
          <section className="d7-chosen-box"><div className="d7-side-heading"><h2>{chosenPlaces.length ? `${chosenPlaces.length} in ${browseCity}` : "Chosen places"}</h2><span className="d7-count-circle">{chosenPlaces.length}</span></div>{chosenPlaces.length ? <div className="d7-chosen-list">{chosenPlaces.map((place) => <button key={place.id} className={`d7-chosen-row ${focusedPlace?.id === place.id ? "d7-focused" : ""}`} onClick={() => setFocusedPlace(place)}><span><strong>{place.name}</strong><small>{place.durationMinutes ? `${place.durationMinutes} min visit` : "Visit duration unknown"}</small></span><ChevronRight size={15} /></button>)}</div> : <p className="d7-chosen-empty">Choose places from the city list to build a local set.</p>}</section>
          {focusedPlace && <section className="d7-detail"><div className="d7-detail-top"><strong>Details</strong><button onClick={() => setFocusedPlace(null)} aria-label="Close details"><X size={15} /></button></div><h3>{focusedPlace.name}</h3><p>{description(focusedPlace)}</p><span>{focusedPlace.category || "Place"} · {focusedPlace.city}</span></section>}
        </aside>
      </div>

    </main>
  );
}

export default ConceptSeven;
