"""One-time preparation of the supplied Notion exports; not an application importer.

Usage: python scripts/prepare-japan-seed.py --places <csv> --itinerary <csv>
Private confirmation identifiers and hotel contact details are excluded from output.
"""
import argparse
import csv
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5


def identifier(kind, name):
    return f"{kind}-{uuid5(NAMESPACE_URL, name).hex[:16]}"


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def temporal(value):
    if not value:
        return None
    match = re.fullmatch(r"(.+) \(GMT([+-]\d+)\)", value)
    if match:
        value = datetime.strptime(match[1], "%B %d, %Y %I:%M %p")
        return value.replace(tzinfo=timezone(timedelta(hours=int(match[2])))).isoformat()
    return datetime.strptime(value, "%B %d, %Y").date().isoformat()


def japan_date(value):
    value = temporal(value)
    if not value or len(value) == 10:
        return value
    return datetime.fromisoformat(value).astimezone(timezone(timedelta(hours=9))).date().isoformat()


def sanitized_notes(row):
    # Avoid copying free-form booking references/contact details into shared fixtures.
    if row["Type"] == "Flight":
        return "Qatar Airways. Times retained from the supplied itinerary export."
    if row["Type"] == "Hotel":
        return "Airport arrival hotel. Paid JPY 15,236. Free cancellation until 2026-09-29 23:59 Asia/Tokyo. Original confirmation details excluded from development seed."
    return row.get("Notes", "")


def duration_estimate(value):
    """Use the upper end of explicit minute/hour ranges; qualitative days stay unknown."""
    match = re.search(r"(\d+)(?:[–-](\d+))?\s*(min|hours?|h)\b", value, re.IGNORECASE)
    if not match:
        return None
    amount = int(match[2] or match[1])
    return amount if match[3].lower() == "min" else amount * 60


def make_seed(places_path, itinerary_path):
    places = []
    for row in read_csv(places_path):
        if not row.get("Name", "").strip():
            continue
        notes = [row.get("Planning notes", "")]
        for key in ("Best time", "Estimated duration", "Nearest station", "Opening hours", "Reservation", "Typical price", "Detour rating", "Needs research", "Location"):
            if row.get(key):
                notes.append(f"{key}: {row[key]}")
        duration = duration_estimate(row.get("Estimated duration", ""))
        if duration:
            notes.append("Planning duration uses the upper end of the source's explicit range. Any queue or transport mentioned separately still needs allocation.")
        places.append({
            "id": identifier("place", row["Name"]), "name": row["Name"],
            "city": row["City"], "area": row["Area"], "category": row["Category"],
            "description": row["Why saved"], "notes": "\n\n".join(filter(None, notes)),
            "sourceUrl": row["Instagram"] or row["Google Maps"],
            "googleMapsUrl": row["Google Maps"], "durationMinutes": duration,
            "priority": {"High": "high", "Backup": "backup"}.get(row["Priority"], "nice"),
            "status": (row["Status"] or "candidate").lower(),
            "latitude": None, "longitude": None, "selected": False,
        })
    seed = {
        "version": 0,
        "trip": {"id": "japan-2026", "name": "Japan 2026", "startDate": "2026-09-30", "endDate": "2026-10-25", "timeZone": "Asia/Tokyo",
                 "arrival": {"airport": "HND", "date": "2026-10-02", "localDateTime": "2026-10-02T00:05:00+09:00"},
                 "departure": {"airport": "HND", "date": "2026-10-25", "localDateTime": "2026-10-25T01:25:00+09:00"}},
        "places": places, "stays": [], "travelLegs": [], "activities": [], "bookings": [], "tasks": [], "packingItems": [],
    }
    for row in read_csv(itinerary_path):
        kind, title = row["Type"], row["Item"]
        notes = sanitized_notes(row)
        if kind in ("Flight", "Hotel") or (row["Status"] == "Confirmed" and title == "Ghibli Park"):
            booking = {"id": identifier("booking", title), "kind": "ticket" if kind == "Plan" else kind.lower(), "title": title,
                       "status": "confirmed", "confirmationCode": None, "url": None, "date": japan_date(row["Start"]), "notes": notes,
                       "start": temporal(row["Start"]), "end": temporal(row["End"]), "location": row["Location"]}
            if kind == "Hotel":
                booking.update(checkIn=japan_date(row["Start"]), checkOut=japan_date(row["End"]))
            seed["bookings"].append(booking)
        if kind == "Transport":
            endpoints = row["Location"].split(" → ", 1)
            seed["travelLegs"].append({"id": identifier("leg", title), "from": endpoints[0], "to": endpoints[-1], "date": japan_date(row["Start"]),
                                       "durationMinutes": None, "mode": "train", "estimated": True, "notes": notes})
        elif kind == "Plan" and title == "Ghibli Park":
            place = next(p for p in places if p["name"] == title)
            place["selected"] = True
            seed["activities"].append({"id": identifier("activity", title), "placeId": place["id"], "date": japan_date(row["Start"]),
                                        "startTime": "10:00", "durationMinutes": None, "status": "confirmed", "notes": notes})
        elif kind == "Plan" and row["End"]:
            city = {"Tokyo — first stay": "Tokyo", "Hakone overnight": "Hakone", "Nagoya / Ghibli Park base": "Nagoya",
                    "Kansai — Osaka base / Kyoto flexible": "Osaka", "Kinosaki Onsen": "Kinosaki Onsen", "Kurashiki overnight": "Kurashiki",
                    "Onomichi / Shimanami": "Onomichi", "Hiroshima / Setouchi base": "Hiroshima", "Tokyo return / recovery": "Tokyo",
                    "Nikkō overnight": "Nikkō", "Final Tokyo / Haneda buffer": "Tokyo"}.get(title, row["Location"])
            seed["stays"].append({"id": identifier("stay", title), "city": city, "name": title, "checkIn": japan_date(row["Start"]),
                                  "checkOut": japan_date(row["End"]), "status": "planned", "bookingId": None, "notes": notes})
        elif kind == "Plan":
            seed["activities"].append({"id": identifier("activity", title), "placeId": None, "title": title, "date": japan_date(row["Start"]),
                                        "startTime": None, "durationMinutes": None, "status": "planned", "notes": notes})
    return seed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--places", required=True)
    parser.add_argument("--itinerary", required=True)
    parser.add_argument("--output", default="data/japan-2026.seed.json")
    args = parser.parse_args()
    seed = make_seed(args.places, args.itinerary)
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: len(value) for key, value in seed.items() if isinstance(value, list)}))
