import { Temporal, type TimeZone } from "@sapporta/shared/temporal";

/*
 * Days as the books count and name them. A day is a plain `YYYY-MM-DD` in
 * the workspace's time zone; the server reads that zone from the request
 * (`workspaceTimeZone`), the frontend from the boot sequence
 * (`appTimeZone`), and both ask here what day it is.
 */

/**
 * Today's date (`YYYY-MM-DD`) in the workspace's time zone, never the
 * machine's. Read when called, so it follows midnight.
 */
export function todayIn(timeZone: TimeZone): string {
  return Temporal.Now.plainDateISO(timeZone).toString();
}

/** "Saturday, 10 January 2026": how Home names today and the Day Book a day. */
export function dayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}
