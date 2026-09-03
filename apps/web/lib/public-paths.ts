/**
 * Which paths a request reaches without a session, and why each one may.
 *
 * The rule lives here and the plumbing lives in `proxy.ts`, because a rule
 * that imports `next/server` can only be tested by starting Next.
 * `test/routes-are-guarded.test.ts` reads this under plain node and walks the
 * routes on disk against it.
 *
 * EVERYTHING ABSENT FROM THIS LIST IS REFUSED. A route added next month is
 * guarded by having been added, which is what KPA-77 asks for: a guard that is
 * not a list somebody must remember to extend. Adding an entry here is the
 * security decision, so each one carries the reason it is safe.
 */

/** One path a request reaches unauthenticated, and why that is safe. */
export interface PublicPath {
  prefix: string;
  because: string;
}

export const PUBLIC: PublicPath[] = [
  // Somewhere to sign in, or there is no way in at all.
  { prefix: '/sign-in', because: 'the gate itself' },
  { prefix: '/forgot-password', because: 'somebody who cannot sign in asks here' },
  { prefix: '/reset', because: 'a reset token authenticates instead. KPA-79' },

  // ADR-0009 makes the first boot the only writer of the account. A guard here
  // would refuse the request that creates the thing the guard checks.
  { prefix: '/setup', because: 'the first boot, before an account exists' },
  { prefix: '/api/account', because: 'the wizard writes the account through it' },

  { prefix: '/api/session', because: 'signing in and out' },

  // KPA-79. Asking for a reset is what somebody who cannot sign in does, and
  // spending the token is authenticated by the token: it is 256 bits, single
  // use, and it dies in an hour.
  { prefix: '/api/reset', because: 'the reset itself, which no session can gate' },

  // ADR-0013: nabium signs its deliveries and `src/webhooks/receive.ts`
  // verifies the HMAC. It carries no cookie and never will, because it is not
  // a browser.
  { prefix: '/api/webhooks', because: 'authenticated by signature, not by session' },
];

/**
 * Whether `path` is one the gate lets through.
 *
 * A prefix matches a whole segment or the path itself, so `/setup` opens
 * `/setup` and `/setup/anything` and leaves `/setupother` guarded. Matching a
 * bare string prefix would open every route that merely starts with the same
 * letters.
 */
export function isPublic(path: string): boolean {
  return PUBLIC.some(
    (entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`),
  );
}
