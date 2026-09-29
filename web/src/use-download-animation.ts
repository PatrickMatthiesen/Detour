import { useEffect, useRef, useState } from "react";

/** Keep fast downloads visible for one complete animation cycle. */
export function useDownloadAnimation(downloading: boolean) {
  const [animating, setAnimating] = useState(downloading);
  const startedAt = useRef(downloading ? Date.now() : 0);
  useEffect(() => {
    if (downloading) {
      startedAt.current = Date.now();
      setAnimating(true);
      return;
    }
    const remaining = Math.max(0, 2400 - (Date.now() - startedAt.current));
    const timer = window.setTimeout(() => setAnimating(false), remaining);
    return () => window.clearTimeout(timer);
  }, [downloading, animating]);
  return { animating: downloading || animating, start: () => {
    startedAt.current = Date.now();
    setAnimating(true);
  } };
}
