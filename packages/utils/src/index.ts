/**
 * Formats a Date object or ISO date string to a localized human-readable date.
 * Example: "Sat, Jan 15"
 */
export function formatDateInTimezone(
  date: Date | string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...options,
  }).format(d);
}

/**
 * Formats a Date object or ISO date string to a localized human-readable time.
 * Example: "10:00 AM"
 */
export function formatTimeInTimezone(
  date: Date | string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...options,
  }).format(d);
}

/**
 * Formats a start and end time range in the specified timezone.
 * Example: "10:00 AM – 11:00 AM"
 */
export function formatTimeRangeInTimezone(
  startTime: Date | string,
  endTime: Date | string,
  timeZone: string
): string {
  const startStr = formatTimeInTimezone(startTime, timeZone);
  const endStr = formatTimeInTimezone(endTime, timeZone);
  return `${startStr} – ${endStr}`;
}

/**
 * Returns whether a timezone string is valid per IANA timezone specification.
 */
export function isValidTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}
