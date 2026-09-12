import { describe, expect, it } from "vitest";
import type { Place } from "../types";
import { photoFor, safeExternalUrl, safePlacePhotoUrl } from "./place-photo";

const place: Place = {
  id: "p-ginza-itoya",
  name: "Ginza Itoya",
  city: "Tokyo",
  area: "Ginza",
};

const photo = {
  id: "photo-42",
  url: "/api/places/p-ginza-itoya/photo?v=photo-42",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Ginza.jpg",
  author: "Example author",
  caption: "",
  kind: "neighbourhood" as const,
  license: "CC BY-SA 4.0",
};

describe("place photo metadata", () => {
  it("uses the private per-place URL and supplies a visible neighbourhood label", () => {
    const details = photoFor({ ...place, photo });

    expect(details.photo?.url).toBe(photo.url);
    expect(details.caption).toBe("Ginza neighbourhood");
    expect(details.showCaption).toBe(true);
    expect(details.credit).toBe("Photo by Example author · CC BY-SA 4.0");
    expect(details.sourceUrl).toBe(photo.sourceUrl);
  });

  it("labels supplied contextual captions without duplicating an existing kind label", () => {
    expect(photoFor({ ...place, photo: { ...photo, caption: "Akihabara" } }).caption)
      .toBe("Akihabara · Neighbourhood photo");
    expect(photoFor({ ...place, photo: { ...photo, caption: "Akihabara neighbourhood" } }).caption)
      .toBe("Akihabara neighbourhood");
    expect(photoFor({ ...place, photo: { ...photo, kind: "illustrative", caption: "Melonpan reference" } }).caption)
      .toBe("Melonpan reference · Illustrative photo");
  });

  it("rejects external, mismatched, and stale image URLs", () => {
    expect(safePlacePhotoUrl(place.id, { ...photo, url: "https://example.com/photo.jpg" })).toBeNull();
    expect(safePlacePhotoUrl(place.id, { ...photo, url: "/api/places/another-place/photo?v=photo-42" })).toBeNull();
    expect(safePlacePhotoUrl(place.id, { ...photo, url: "/api/places/p-ginza-itoya/photo?v=old-photo" })).toBeNull();
  });

  it("accepts the compact cache version emitted for a GUID photo id", () => {
    const guidPhoto = {
      ...photo,
      id: "2d741c53-42f2-4519-94d7-fbcaf84d7dd2",
      url: "/api/places/p-ginza-itoya/photo?v=2d741c5342f2451994d7fbcaf84d7dd2",
    };

    expect(safePlacePhotoUrl(place.id, guidPhoto)).toBe(guidPhoto.url);
  });

  it("allows only web URLs for public attribution", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("https://example.com/source")).toBe("https://example.com/source");
  });
});
