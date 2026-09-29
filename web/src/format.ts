const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateOnlyValue(value: string): Date {
  const date = value.slice(0, 10);
  return new Date(`${date}T12:00:00Z`);
}

/** Format a calendar date without allowing the browser timezone to shift it. */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateOnlyValue(date));
}

export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(dateOnlyValue(date));
}

export function weekday(date: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: style,
    timeZone: "UTC",
  }).format(dateOnlyValue(date));
}

export function dateParts(date: string) {
  const value = dateOnlyValue(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(value);
  return {
    date,
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? "",
    label: longDate(date),
  };
}

/** Format a timestamp in the trip timezone while retaining date-only wall dates. */
export function formatDateTime(value: string, timeZone = "Asia/Tokyo"): string {
  if (DATE_ONLY.test(value)) return longDate(value);
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (!hasOffset) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/.exec(value);
    if (!match) return value;
    return `${longDate(match[1])} at ${match[2]}`;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instant));
  } catch {
    return value;
  }
}
