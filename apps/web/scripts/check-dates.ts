// The check the date box needs. Run: npm run check
//
// A parser that reads words is guessed at until it is pinned down. Each case
// below is one somebody will type on the first day, and a wrong answer here
// is worse than no answer: it files the issue under a date nobody chose.

import assert from "node:assert/strict";

import { parseDate } from "../lib/parse-date.ts";

// Monday, so every weekday case below is countable by hand.
const MONDAY = "2026-08-31";

function reads(text: string, want: string | null, from = MONDAY) {
  assert.equal(
    parseDate(text, from),
    want,
    `"${text}" from ${from} should read as ${want}`
  );
}

// 1. The words that name a day outright.
reads("today", "2026-08-31");
reads("tomorrow", "2026-09-01");
reads("yesterday", "2026-08-30");
reads("  Tomorrow  ", "2026-09-01");

// 2. A weekday means the one that has not happened yet, and today's own
//    weekday means a week from now rather than this morning.
reads("wednesday", "2026-09-02");
reads("Wed", "2026-09-02");
reads("next friday", "2026-09-04");
reads("monday", "2026-09-07");
reads("sunday", "2026-09-06");

// 3. Weeks, months and years, from the Monday that opens the next one.
reads("next week", "2026-09-07");
reads("next month", "2026-09-30");
reads("next year", "2027-08-31");
reads("end of month", "2026-08-31");

// A Tuesday reaches the same Monday, which is what "next week" has to mean
// for it to be worth typing.
reads("next week", "2026-08-31", "2026-08-25");

// 4. Counting forward.
reads("in 3 days", "2026-09-03");
reads("3 days", "2026-09-03");
reads("+10", "2026-09-10");
reads("in 2 weeks", "2026-09-14");
reads("in 1 month", "2026-09-30");

// 5. A date written out, in the orders people write it.
reads("1 Sep", "2026-09-01");
reads("1st of September 2026", "2026-09-01");
reads("Sep 1", "2026-09-01");
reads("September 1, 2026", "2026-09-01");
reads("2026-09-01", "2026-09-01");
reads("1/9", "2026-09-01");
reads("1/9/2026", "2026-09-01");
reads("1/9/26", "2026-09-01");

// A bare day and month that has been and gone means the one to come.
reads("1 Aug", "2027-08-01");

// 6. A date that is not one comes back null, so the box can say so rather
//    than file the issue under a day nobody picked.
reads("", null);
reads("sometime", null);
reads("31 February 2026", null);
reads("2026-02-31", null);
reads("the day the invoice clears", null);

// 7. The end of a month is the end of that month, whatever its length.
reads("next month", "2027-02-28", "2027-01-31");
reads("end of month", "2028-02-29", "2028-02-03");


// 8. A due date counts from the day work starts, because that is how a range
//    is read. "Friday" on a job starting Tuesday is the Friday of that week.
reads("friday", "2026-09-04", "2026-09-01");
reads("friday", "2026-09-11", "2026-09-05");
reads("tomorrow", "2026-09-02", "2026-09-01");

console.log(
  "dates OK: words, weekdays, counts and written dates all read from whichever day they are told to count from"
);
