// One place for every date and time the interface prints.
//
// The timezone is fixed on purpose. The fixtures carry bare dates like
// "2026-08-19", which parse as UTC midnight, and toLocaleDateString then
// renders them in whatever zone the runtime happens to be in. A reader in Los
// Angeles saw every fact dated a day early, and a production build baked the
// build machine's zone into the prerendered audit log, which then disagreed
// with the browser on hydration.
//
// Shane and his data are in Sydney. Pinning the zone makes the server and the
// browser agree, and makes the printed date the date the source actually says.

const ZONE = "Australia/Sydney";
const LOCALE = "en-AU";

/** 19 Aug 2026 */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    timeZone: ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Tuesday 25 August */
export function formatLongDay(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    timeZone: ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Today, on the clock, in the zone the rest of this file prints in.
 *
 * The fixtures freeze a different day so the demo always has a current sprint
 * and a stale fact to show. That frozen day is right for reading the data and
 * wrong for reading a person: somebody typing "Friday" means the Friday on
 * the calendar in front of them. en-CA is the locale that spells a date
 * YYYY-MM-DD, which is the shape every date in this app is stored in.
 */
export function realToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ZONE });
}

/** 19 August 2026 */
export function formatFullDay(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    timeZone: ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** 19 Aug */
export function formatShortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    timeZone: ZONE,
    day: "numeric",
    month: "short",
  });
}

/** 10:00 am */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** 25 Aug, 6:02 am */
export function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, {
    timeZone: ZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Whole days between a review date and today, never negative. */
export function daysPast(iso: string, today: string): number {
  const ms = new Date(today).getTime() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
