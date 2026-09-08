export type Priority = "required" | "high" | "nice" | "none";

export interface Place {
  id: string;
  name: string;
  city: string;
  area?: string | null;
  category?: string | null;
  description?: string | null;
  notes?: string | null;
  sourceUrl?: string | null;
  googleMapsUrl?: string | null;
  instagramUrl?: string | null;
  durationMinutes?: number | null;
  durationText?: string | null;
  openingHours?: string | null;
  reservation?: string | null;
  needsResearch?: boolean;
  priority?: Priority;
  status?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  selected?: boolean;
}

export interface Activity {
  id: string;
  placeId: string | null;
  title?: string | null;
  date: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  status?: string | null;
}
export interface Stay {
  id: string;
  city: string;
  name?: string | null;
  checkIn: string;
  checkOut: string;
  status?: string | null;
  bookingId?: string | null;
}
export interface TravelLeg {
  id: string;
  from: string;
  to: string;
  date: string;
  durationMinutes?: number | null;
  mode?: string | null;
  estimated?: boolean;
}
export interface Booking {
  id: string;
  kind: string;
  title: string;
  status: string;
  confirmationCode?: string | null;
  url?: string | null;
  start?: string | null;
  end?: string | null;
  date?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  location?: string | null;
  notes?: string | null;
}
export interface Task {
  id: string;
  title: string;
  dueDate?: string | null;
  completed: boolean;
  scope: string;
  reminderAt?: string | null;
}
export interface PackingItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  packed: boolean;
  bag?: string | null;
  notes?: string | null;
}
export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timeZone?: string | null;
  arrival?: {
    airport: string;
    date: string;
    time?: string | null;
    localDateTime?: string | null;
  } | null;
  departure?: {
    airport: string;
    date: string;
    time?: string | null;
    localDateTime?: string | null;
  } | null;
}
export interface TripSnapshot {
  version: number;
  trip: Trip;
  places: Place[];
  stays: Stay[];
  travelLegs: TravelLeg[];
  activities: Activity[];
  bookings: Booking[];
  tasks: Task[];
  packingItems: PackingItem[];
}
