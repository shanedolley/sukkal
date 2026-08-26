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
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Opens a client against the connection string in `variable`.
 *
 * The caller connects and ends it. Two translations happen here and nowhere
 * else.
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
 */
export function connect(variable = 'DATABASE_URL'): pg.Client {
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

  return new pg.Client({ connectionString: url.toString() });
}
