import { useState } from "react";
import { Camera } from "lucide-react";
import type { Place } from "../types";
import { photoFor } from "./place-photo";

export default function PlacePhoto({ place, className = "" }: { place: Place; className?: string }) {
  const { photo, caption, showCaption, credit, sourceUrl } = photoFor(place);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(photo?.url && failedUrl === photo.url);

  return (
    <figure className={`dk-photo ${className}`}>
      {photo && !failed ? (
        <>
          <img
            src={photo.url}
            alt={caption}
            loading="lazy"
            onError={() => setFailedUrl(photo.url)}
          />
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="dk-credit"
              title={credit}
              onClick={(event) => event.stopPropagation()}
            >
              {credit}
            </a>
          ) : credit ? (
            <span className="dk-credit" title={credit}>{credit}</span>
          ) : null}
          {showCaption && <figcaption>{caption}</figcaption>}
        </>
      ) : (
        <div className="dk-no-photo">
          <Camera size={24} />
          <span>{place.category?.split(",")[0] || "Saved place"}</span>
          <small>{failed ? "Photo unavailable" : "Photo not added"}</small>
        </div>
      )}
    </figure>
  );
}
