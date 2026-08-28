export const formatDateInTimezone = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);

export const formatTimeInTimezone = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
