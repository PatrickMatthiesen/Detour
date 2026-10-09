import { useEffect, useState } from "react";
import type { TripSnapshot } from "../types";
import { datesForTrip, daySummary } from "./planning";

export function tripDate(timeZone?: string | null, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone?.trim() || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function useTripToday(timeZone?: string | null): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    refresh();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return tripDate(timeZone, now);
}

export function defaultPlanDate(snapshot: TripSnapshot, today: string): string {
  const dates = datesForTrip(snapshot);
  if (dates.includes(today)) return today;
  const arrival = snapshot.trip.arrival?.date?.slice(0, 10) || snapshot.trip.arrival?.localDateTime?.slice(0, 10);
  const preferred = arrival || snapshot.stays[0]?.checkIn?.slice(0, 10);
  return preferred && dates.includes(preferred) ? preferred : dates[0] || "";
}

export function defaultCity(snapshot: TripSnapshot, today: string): string {
  const date = defaultPlanDate(snapshot, today);
  return daySummary(snapshot, date).cities[0] || snapshot.stays[0]?.city || snapshot.places[0]?.city || "All cities";
}
