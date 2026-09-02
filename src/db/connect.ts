/**
 * The one place KPA opens a database connection.
 *
 * Configuration comes from the environment. No host, user, password or
 * connection string appears in this repository. `.env.example` names the
 * variables and holds no value; the real ones live in `~/.config/kpa/env`.
 * See `docs/runbooks/secrets.md`.
 */
import pg from 'pg';

/**
 * Hand a `date` column back as the string Postgres sent.
 *
 * The driver's default parses it into a JavaScript `Date` at local midnight,
 * and reading that back as UTC moves it a day west of Greenwich. A fact
 * retired on 1 June then reads as 31 May from Sydney, which is a wrong answer
 * that looks right. A calendar date has no time zone, so keep it as text.
 *
 * This takes the registry rather than reaching for one, because there are two.
 * `apps/web` installs its own copy of the driver, so a bare `pg` resolves to
 * the root's copy here and to the web tier's copy there, and a parser set on
 * one is absent from the other. `apps/web/lib/db.ts` calls this with its own.
 * KPA-68 makes `apps/web` a workspace of the root, which leaves one copy and
 * makes the second call unnecessary.
 */
export function keepDatesAsText(types: typeof pg.types): void {
  types.setTypeParser(types.builtins.DATE, (value: string) => value);
}

keepDatesAsText(pg.types);

/**
 * The modes that encrypt.
 *
 * `prefer` is absent on purpose. It falls back to plain text without saying
 * so, which is the failure this check exists to catch.
 */
const ENCRYPTED = new Set(['require', 'verify-ca', 'verify-full', 'no-verify']);

/**
 * Hosts that need no encryption, because the traffic reaches no network.
 *
 * amaterasu's Postgres listens on `127.0.0.1` as well as the LAN address, so
 * a worker running on the box connects this way and pays nothing for TLS it
 * does not need. Continuous integration uses the same path against a service
 * container. Every other host must encrypt.
 */
export const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Reads `variable` and returns the connection string this driver accepts.
 *
 * Two translations happen here and nowhere else.
 *
 * The first refuses a connection string that does not ask for encryption.
 * SCRAM protects the password exchange and leaves the content in the clear,
 * and the content includes Collibra customer material on a LAN that carries
 * other devices.
 *
 * The second rewrites `require` to `no-verify`. amaterasu presents Ubuntu's
 * self-signed certificate, so no client can verify the chain. libpq reads
 * `require` as "encrypt, do not verify", and `psql` therefore connects. This
 * driver reads the same word as "encrypt and verify", and fails. Translating
 * here leaves one environment file readable by both.
 *
 * `connect` below is the ordinary caller. The worker needs the string itself,
 * because pg-boss opens its own pool from one, and it has to open that pool
 * against the same checks every other connection passes.
 */
export function connectionString(variable = 'DATABASE_URL'): string {
  const value = process.env[variable];
  if (!value) {
    throw new Error(
      `${variable} is unset. See docs/runbooks/secrets.md: real values live in ` +
        '~/.config/kpa/env.',
    );
  }

  const url = new URL(value);
  const mode = url.searchParams.get('sslmode');
  const local = LOOPBACK.has(url.hostname);
  if (!local && (mode === null || !ENCRYPTED.has(mode))) {
    throw new Error(
      `${variable} asks for sslmode=${mode ?? 'nothing'} against ${url.hostname}. ` +
        'This connection carries customer material over a shared LAN, so it must ' +
        'be encrypted. Use sslmode=require.',
    );
  }

  if (mode === 'require') {
    url.searchParams.set('sslmode', 'no-verify');
  }

  return url.toString();
}

/** Opens a client against the connection string in `variable`. The caller
 *  connects and ends it. */
export function connect(variable = 'DATABASE_URL'): pg.Client {
  return new pg.Client({ connectionString: connectionString(variable) });
}
