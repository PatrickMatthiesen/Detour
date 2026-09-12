import type { Place, PlacePhotoMetadata } from "../types";

export type PlacePhotoDetails = {
  photo: PlacePhotoMetadata | null;
  caption: string;
  showCaption: boolean;
  credit: string;
  sourceUrl: string | null;
};

const photoKinds = new Set(["place", "neighbourhood", "illustrative"]);
const sameOriginBase = "https://detour.local";

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function safePlacePhotoUrl(
  placeId: string,
  photo: PlacePhotoMetadata | null | undefined,
): string | null {
  if (!photo?.url || !photo.id || !photoKinds.has(photo.kind)) return null;
  try {
    const url = new URL(photo.url, sameOriginBase);
    const expectedPath = `/api/places/${encodeURIComponent(placeId)}/photo`;
    if (url.origin !== sameOriginBase || url.pathname !== expectedPath) return null;
    const version = url.searchParams.get("v");
    if (!version || version.replaceAll("-", "").toLowerCase() !== photo.id.replaceAll("-", "").toLowerCase()) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function fallbackCaption(place: Place, photo: PlacePhotoMetadata): string {
  if (photo.kind === "neighbourhood") {
    return `${place.area?.trim() || place.city} neighbourhood`;
  }
  if (photo.kind === "illustrative") return "Illustrative photo";
  return place.name;
}

function labelledCaption(place: Place, photo: PlacePhotoMetadata, suppliedCaption: string): string {
  if (!suppliedCaption) return fallbackCaption(place, photo);
  if (photo.kind === "neighbourhood" && !/\bneighbou?rhood\b/i.test(suppliedCaption)) {
    return `${suppliedCaption} · Neighbourhood photo`;
  }
  if (photo.kind === "illustrative" && !/\billustrat(?:ive|ion)\b/i.test(suppliedCaption)) {
    return `${suppliedCaption} · Illustrative photo`;
  }
  return suppliedCaption;
}

export function photoFor(place: Place): PlacePhotoDetails {
  const url = safePlacePhotoUrl(place.id, place.photo);
  if (!place.photo || !url) {
    return { photo: null, caption: "", showCaption: false, credit: "", sourceUrl: null };
  }

  const photo = { ...place.photo, url };
  const suppliedCaption = photo.caption?.trim() || "";
  const caption = labelledCaption(place, photo, suppliedCaption);
  const sourceUrl = safeExternalUrl(photo.sourceUrl);
  const credit = [photo.author?.trim() ? `Photo by ${photo.author.trim()}` : sourceUrl ? "Photo source" : null, photo.license?.trim()]
    .filter(Boolean)
    .join(" · ");

  return {
    photo,
    caption,
    showCaption: Boolean(suppliedCaption) || photo.kind !== "place",
    credit,
    sourceUrl,
  };
}
