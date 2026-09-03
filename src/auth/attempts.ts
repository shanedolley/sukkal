/**
 * What a run of failed sign-ins costs, and where every sign-in is written down.
 *
 * ADR-0023 makes the application the only gate, so the sign-in route faces
 * whoever can reach the box, and one account means an attacker needs one
 * password and has as many tries as the box will answer.
 *
 * A DELAY, NEVER A LOCK, and KPA-78 is why. A lockout on the only account is a
 * denial of service against the only person who can use the system, and there
 * is nobody to lift it. So a run of failures buys a wait in front of the next
 * attempt, the wait grows to a ceiling of eight seconds, and a correct
 * password works at every point in the run. Shane is never shut out, so
 * nothing has to expire before he can get in: the run is forgotten fifteen
 * minutes after the last failure, and that is a tidy-up rather than a release.
 *
 * WHY EIGHT SECONDS IS ENOUGH, measured rather than assumed. One `verify`
 * costs 171 ms on this Mac at ADR-0020's cost, and eight in parallel take
 * 378 ms because node's scrypt runs on a four-thread pool. So the door already
 * answers about six guesses a second and never runs more than four hashes at
 * once, whatever arrives. Against `lib/password.ts`'s rules, sixteen
 * characters with a capital, a number and two marks, no online rate is a
 * threat. The wait exists to keep a flood off that pool and to put every
 * attempt in the log, rather than to make a strong password stronger.
 *
 * ONE COUNTER FOR THE INSTALLATION, whatever address was typed. An
 * installation has one account, so a failure against an address nobody holds
 * is a failure at this door. Counting only the known address would leave the
 * throttle behind a name an attacker can simply not type, and it would tell
 * them which name that is.
 *
 * `now` is an argument everywhere, so a test moves fifteen minutes in one line.
 */
import type { ClientBase } from 'pg';

import { OWNER } from './reset.ts';

/** Failures that cost nothing. A person mistypes a long password. */
export const FREE = 2;

/** The longest anybody waits, in seconds. Nobody is locked out, so the
 *  ceiling is what makes the worst case a pause rather than an outage. */
export const CAP_SECONDS = 8;

/** A run of failures is forgotten this long after the last one. */
export const FORGET_MINUTES = 15;

/** The state of the door, before any password is checked. */
export interface Standing {
  /** Failures in the current run. Zero once the run is forgotten. */
  failures: number;
  /** How long to wait before checking a password, in seconds. */
  waitSeconds: number;
}

/**
 * How long a run of `failures` costs, in seconds.
 *
 * The first two are free, then it doubles: 1, 2, 4, 8, and 8 from there on.
 * Doubling is what makes a sustained run expensive quickly while a person who
 * mistypes twice notices nothing.
 */
export function waitFor(failures: number): number {
  if (failures <= FREE) return 0;
  return Math.min(CAP_SECONDS, 2 ** (failures - FREE - 1));
}

/** Whether a run that ended at `at` has been forgotten by `now`. */
function forgotten(at: Date | null, now: Date): boolean {
  if (at === null) return true;
  return now.getTime() - at.getTime() >= FORGET_MINUTES * 60 * 1000;
}

/**
 * What the door costs right now.
 *
 * A run older than `FORGET_MINUTES` reads as no run at all. The row is left
 * alone rather than cleared here: a read that writes turns every sign-in into
 * a write, and `failed` and `cleared` both overwrite it anyway.
 */
export async function standing(client: ClientBase, now: Date): Promise<Standing> {
  const found = await client.query<{
    sign_in_failures: number;
    sign_in_failed_at: Date | null;
  }>('SELECT sign_in_failures, sign_in_failed_at FROM users WHERE id = $1', [OWNER]);

  const row = found.rows[0];
  if (row === undefined || forgotten(row.sign_in_failed_at, now)) {
    return { failures: 0, waitSeconds: 0 };
  }

  return {
    failures: row.sign_in_failures,
    waitSeconds: waitFor(row.sign_in_failures),
  };
}

/**
 * Counts one failure, and answers what the next attempt will cost.
 *
 * A forgotten run starts again at one rather than carrying on from where it
 * left off. Otherwise a failure a week apart would eventually reach the
 * ceiling and stay there, which is the permanent lockout KPA-78 refuses.
 */
export async function failed(client: ClientBase, now: Date): Promise<Standing> {
  const before = await standing(client, now);
  const failures = before.failures + 1;

  await client.query(
    'UPDATE users SET sign_in_failures = $2, sign_in_failed_at = $3 WHERE id = $1',
    [OWNER, failures, now],
  );

  return { failures, waitSeconds: waitFor(failures) };
}

/**
 * Ends the run, and answers how long it was.
 *
 * A sign-in that works calls this, and so does
 * `scripts/reset-password.sh --unlock`, which is the recovery path KPA-78 asks
 * for: one that does not need the web interface, matching the escape hatch
 * ADR-0009 already names for the reset.
 */
export async function cleared(client: ClientBase): Promise<void> {
  await client.query(
    'UPDATE users SET sign_in_failures = 0, sign_in_failed_at = NULL WHERE id = $1',
    [OWNER],
  );
}

/** Waits, and nothing else. A separate function so a test passes its own. */
export type Wait = (seconds: number) => Promise<void>;

/** The real one. A route hands this in, and a test hands in one that records
 *  the number and returns at once. */
export const sleep: Wait = (seconds) =>
  new Promise((done) => setTimeout(done, seconds * 1000));

/** What happened at the door, as the log records it. */
export interface Attempt {
  /** What was typed in the address box, or null when nothing was. */
  email: string | null;
  /** Where the request came from, when the caller sent it. */
  from?: string | null;
  /** Whether it worked. */
  ok: boolean;
  /** The sentence the log keeps. It may name what the answer may not. */
  result: string;
}

/** The rule a refused sign-in cites. Migration 026 writes the row. */
export const RULE = 'auth.sign-in';

/** As much of a typed address as the log keeps. It is written by whoever is
 *  knocking, so it is bounded before it is stored. */
const ADDRESS_KEPT = 200;

/**
 * Writes one sign-in to the audit log, allowed or refused.
 *
 * KPA-78 requires this and gives the reason: the log is the safety net, and a
 * sign-in is the highest-value event on the box.
 *
 * IT DOES NOT GO THROUGH `act`. That function is the one path to an *outbound*
 * action, and it is a Permit and a policy verdict because ADR-0005 governs
 * what KPA sends out. A sign-in reaches nothing outbound and no rule judges
 * whether it may be attempted, so `decide` would deny every one by default.
 * The row is written here, and `src/policy/act.ts` names this second writer.
 *
 * THE ADDRESS IS WHATEVER WAS TYPED. It is attacker-controlled text, so it is
 * trimmed to 200 characters and stored as data. Keeping it is the point: an
 * address nobody holds, tried a hundred times, is the shape of an attack, and
 * the log is where that shape shows.
 */
export async function record(
  client: ClientBase,
  attempt: Attempt,
  now: Date,
): Promise<void> {
  const typed = (attempt.email ?? '').trim().slice(0, ADDRESS_KEPT);
  const who = typed === '' ? 'no address' : typed;
  const where = attempt.from ? ` from ${attempt.from}` : '';

  await client.query(
    `INSERT INTO audit (at, action, intent, before, outcome, result, reverse, space, rule)
     VALUES ($1, 'sign-in', $2, $3, $4, $5, $6, 'shared', $7)`,
    [
      now,
      `Sign in as ${who}${where}`,
      'No session on this browser.',
      attempt.ok ? 'allowed' : 'denied',
      attempt.result,
      attempt.ok
        ? 'Sign out, which deletes the session row.'
        : 'Nothing to reverse. Nobody signed in.',
      attempt.ok ? null : RULE,
    ],
  );
}
