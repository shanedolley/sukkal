// Turning what a person types into a date.
//
// The field takes words rather than a grid of numbers, because "next Tuesday"
// is the thought a person already has, and hunting for it on a calendar is
// the chore that stands between the thought and the date.
//
// Every answer is relative to a reference date the caller passes, never to
// the clock. The board has one notion of today, and a row typed "tomorrow"
// has to land on the day the board calls tomorrow.

const DAY = 86_400_000;

// Sunday first, because that is the order getUTCDay counts in.
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** The words that name a day outright, as an offset from the reference. */
const NAMED: Record<string, number> = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  tmrw: 1,
  yesterday: -1,
};

/** Everything is UTC, so a bare date never drifts across a zone boundary. */
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A date, or null when the numbers do not make one.
 *
 * Date.UTC rolls 31 February forward to 3 March. A date that rolled was never
 * a date, so it is caught here rather than handed back as a surprise.
 */
function exact(year: number, month: number, day: number): string | null {
  const ms = Date.UTC(year, month - 1, day);
  const made = new Date(ms);
  if (
    made.getUTCFullYear() !== year ||
    made.getUTCMonth() !== month - 1 ||
    made.getUTCDate() !== day
  ) {
    return null;
  }
  return iso(ms);
}

/** The named weekday after the reference day, never the reference day itself. */
function nextWeekday(from: number, want: number): number {
  const have = new Date(from).getUTCDay();
  return from + ((want - have + 7) % 7 || 7) * DAY;
}

/** The Monday that opens the week after the reference day. */
function nextMonday(from: number): number {
  return nextWeekday(from, 1);
}

/** One month on keeps the day of the month, so 31 January lands on 28 February. */
function addMonths(from: number, count: number): number {
  const at = new Date(from);
  const day = at.getUTCDate();
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + count;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(day, last));
}

/** The index of a month or weekday a person typed short. */
function whichOf(names: string[], word: string): number {
  if (word.length < 3) return -1;
  return names.findIndex((name) => name.startsWith(word));
}

/**
 * The year that puts a bare day and month ahead rather than behind.
 *
 * Somebody typing "1 Sep" in December means the September to come, not the
 * one that has been and gone.
 */
function comingYear(from: number, month: number, day: number): number {
  const year = new Date(from).getUTCFullYear();
  return Date.UTC(year, month - 1, day) >= from ? year : year + 1;
}

/**
 * What a person typed, as an ISO date, or null when it is not one.
 *
 * An empty box is not this function's business. It means the date is being
 * taken away, and the caller has to say so rather than read it out of a null
 * that also means "those words are not a date".
 */
export function parseDate(text: string, today: string): string | null {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(?:on|by|due) /, "");
  if (!said) return null;

  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from)) return null;

  // A date already written as one.
  const written = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(said);
  if (written) {
    return exact(Number(written[1]), Number(written[2]), Number(written[3]));
  }

  if (Object.hasOwn(NAMED, said)) {
    return iso(from + NAMED[said] * DAY);
  }

  if (said === "next week") return iso(nextMonday(from));
  if (said === "next month") return iso(addMonths(from, 1));
  if (said === "next year") return iso(addMonths(from, 12));
  if (said === "end of month") {
    const at = new Date(from);
    return iso(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
  }

  // A count of days, weeks or months from here. "in 3 days", "3 days", "+3".
  const counted =
    /^(?:in )?(\d{1,3}) ?(d|day|days|w|week|weeks|m|month|months)$/.exec(said) ??
    /^\+(\d{1,3})$/.exec(said);
  if (counted) {
    const count = Number(counted[1]);
    const unit = counted[2] ?? "days";
    if (unit.startsWith("m")) return iso(addMonths(from, count));
    return iso(from + count * (unit.startsWith("w") ? 7 : 1) * DAY);
  }

  // A weekday, with or without the word that adds nothing to it. "Next
  // Friday" and "Friday" both mean the Friday that has not happened yet.
  const weekday = /^(?:next |this |coming )?([a-z]+)$/.exec(said);
  if (weekday) {
    const index = whichOf(WEEKDAYS, weekday[1]);
    if (index >= 0) return iso(nextWeekday(from, index));
  }

  // A day and a month, in either order, with the year optional. "1 Sep",
  // "1st of September 2026", "Sep 1".
  const dayFirst =
    /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/.exec(said);
  const monthFirst =
    /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{4}))?$/.exec(said);
  const spelt = dayFirst
    ? { day: Number(dayFirst[1]), word: dayFirst[2], year: dayFirst[3] }
    : monthFirst
      ? { day: Number(monthFirst[2]), word: monthFirst[1], year: monthFirst[3] }
      : null;
  if (spelt) {
    const month = whichOf(MONTHS, spelt.word) + 1;
    if (month > 0) {
      const year = spelt.year
        ? Number(spelt.year)
        : comingYear(from, month, spelt.day);
      return exact(year, month, spelt.day);
    }
  }

  // Numbers with slashes, day first. Shane is in Sydney, where 1/9 is the
  // first of September and never the ninth of January.
  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(said);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    const typed = slashed[3];
    const year = typed
      ? typed.length === 2
        ? 2000 + Number(typed)
        : Number(typed)
      : comingYear(from, month, day);
    return exact(year, month, day);
  }

  return null;
}
