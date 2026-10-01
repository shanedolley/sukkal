/**
 * The read and write path for a connection and its credential.
 *
 * TWO READS, AND ONLY ONE OF THEM CARRIES THE SECRET. `listConnections` is
 * what a screen calls, and its query names its columns, so no parameter and no
 * caller can make it return the ciphertext or the plaintext. `secretFor` is
 * what the worker calls at the moment it reaches a provider, and it is the
 * only function in this repository that returns a plaintext secret. Keeping
 * them apart is the point of the module: a route that reaches for the wrong
 * one is a route that named it.
 *
 * `src/connections/crypto.ts` seals and opens the bytes, under a key read from
 * the environment. The connection id is what each row is sealed against, so a
 * secret decrypts under its own connection and under no other.
 *
 * A `date` column comes back as a 'YYYY-MM-DD' string, because
 * `src/db/connect.ts` tells the driver so and every client here is opened
 * through it. Compare these fields as text. Parsing one into a Date puts it at
 * local midnight and reads back a day west of Greenwich.
 */
import type { ClientBase } from 'pg';
import { decrypt, encrypt } from './crypto.ts';

/** What the dialog collected, before the row exists. */
export interface NewConnection {
  provider: string;
  name: string;
  method: string;
  /** Service ids. Empty when the provider carries one thing. */
  services?: string[];
  /**
   * The address a sending connection's mail comes from, and null on one that
   * sends nothing. KPA-158 gave it a column because `name` was doing both
   * jobs and a person naming the card after the account broke the send.
   * `migrations/032_connection_send_from.sql` holds it to a shape and
   * `apps/web/app/(app)/api/connections/route.ts` is what refuses a Resend
   * card without one.
   */
  sendFrom?: string | null;
}

/** The dates the provider named, and neither is compulsory. */
export interface CredentialDates {
  issuedOn?: string | null;
  expiresOn?: string | null;
}

/**
 * A connection as a screen may see it.
 *
 * `hasSecret` is how far this goes toward the credential. Whether a secret is
 * stored answers the only question a screen has, and the bytes answer none of
 * them.
 */
export interface Connection {
  id: string;
  provider: string;
  name: string;
  method: string;
  services: string[];
  hasSecret: boolean;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedOn: string | null;
  verdict: string | null;
  /** Whether the last check found it working. Null until a check has run,
   *  which reads as unknown rather than broken. KPA-107. */
  verifiedOk: boolean | null;
  /** The address a sending connection's mail comes from. Null on one that
   *  sends nothing. KPA-160. */
  sendFrom: string | null;
}

interface Row {
  id: string;
  provider: string;
  name: string;
  method: string;
  services: string[];
  has_secret: boolean;
  issued_on: string | null;
  expires_on: string | null;
  verified_on: string | null;
  verdict: string | null;
  verified_ok: boolean | null;
  send_from: string | null;
}

/** Adds one account and returns its id. The table refuses a second account of
 *  the same name on the same provider, and welcomes a second on a new name. */
export async function addConnection(
  client: ClientBase,
  connection: NewConnection,
): Promise<string> {
  const added = await client.query<{ id: string }>(
    `INSERT INTO connections (provider, name, method, services, send_from)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      connection.provider,
      connection.name,
      connection.method,
      connection.services ?? [],
      // An empty box is no address rather than an empty one, which the column's
      // own check would refuse anyway.
      connection.sendFrom?.trim() || null,
    ],
  );

  const id = added.rows[0]?.id;
  if (id === undefined) throw new Error('the insert returned no connection id.');
  return id;
}

/**
 * The connection `provider` holds under `name`, or null.
 *
 * The OAuth callback calls it. A provider names the account that consented,
 * and three Google accounts have to become three rows rather than one row
 * written over twice. Nothing else makes the pair unique: two connections may
 * share a name on purpose, because a person naming two Jira sites the same
 * thing has made a mess rather than an error.
 *
 * It answers the oldest match, so a grant repeated against a name somebody
 * duplicated by hand refreshes the row that was there first.
 */
export async function connectionNamed(
  client: ClientBase,
  provider: string,
  name: string,
): Promise<string | null> {
  const found = await client.query<{ id: string }>(
    `SELECT id FROM connections
      WHERE provider = $1 AND lower(name) = lower($2)
      ORDER BY created_at, id LIMIT 1`,
    [provider, name.trim()],
  );
  return found.rows[0]?.id ?? null;
}

/**
 * Which provider a connection is on, or null when no such row exists.
 *
 * The removal path calls it. Revoking a token needs the record that names the
 * revoke endpoint, and the record is keyed by provider, so this is the one
 * question asked before the row goes. `listConnections` would answer it and
 * read every row to do so.
 */
export async function providerOf(
  client: ClientBase,
  id: string,
): Promise<string | null> {
  const found = await client.query<{ provider: string }>(
    'SELECT provider FROM connections WHERE id = $1',
    [id],
  );
  return found.rows[0]?.provider ?? null;
}

/**
 * The provider and method a connection runs, or null when no such row exists.
 *
 * The rename route calls it to refuse a grant method, which only the row
 * names and the request body does not.
 */
export async function methodOf(
  client: ClientBase,
  id: string,
): Promise<{ provider: string; method: string } | null> {
  const found = await client.query<{ provider: string; method: string }>(
    'SELECT provider, method FROM connections WHERE id = $1',
    [id],
  );
  return found.rows[0] ?? null;
}

/**
 * Renames a connection. A rename touches no credential: the ciphertext, the
 * id and the created_at of the row it points at are all untouched.
 */
export async function renameConnection(
  client: ClientBase,
  id: string,
  name: string,
): Promise<void> {
  await client.query('UPDATE connections SET name = $2 WHERE id = $1', [id, name]);
}

/**
 * Seals `secret` and stores it against `id`, replacing whatever was there.
 *
 * Retyping a key is the ordinary case, so this replaces rather than refuses.
 * It clears the verification with it: a new secret has never been tried, and
 * carrying the old verdict forward would tell the briefing that a key nobody
 * has used still works.
 *
 * A blank secret is refused here. The table refuses an empty one already,
 * because sealing an empty string comes to its header and nothing more, and
 * the length check wants one byte past that. A space would pass the table's
 * test while reaching nothing, which is why this one trims first.
 */
export async function setCredential(
  client: ClientBase,
  id: string,
  secret: string,
  dates: CredentialDates = {},
): Promise<void> {
  if (secret.trim() === '') {
    throw new Error('a connection secret cannot be blank.');
  }

  await client.query(
    `INSERT INTO connection_credentials (connection, ciphertext, issued_on, expires_on)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (connection) DO UPDATE
        SET ciphertext = EXCLUDED.ciphertext,
            issued_on = EXCLUDED.issued_on,
            expires_on = EXCLUDED.expires_on,
            verified_on = NULL,
            verdict = NULL,
            verified_ok = NULL,
            verified_at = NULL`,
    [id, encrypt(secret, id), dates.issuedOn ?? null, dates.expiresOn ?? null],
  );
}

/**
 * Records what the provider said when somebody last asked, dated today, and
 * whether that answer means the credential works.
 *
 * It throws when no credential is stored. A verification of nothing is a
 * verdict about a secret that does not exist, and losing it silently is how a
 * briefing comes to report a connection nobody ever checked.
 */
export async function recordVerification(
  client: ClientBase,
  id: string,
  verdict: string,
  ok: boolean,
): Promise<void> {
  if (verdict.trim() === '') {
    throw new Error('a verification has to say something.');
  }

  const updated = await client.query(
    `UPDATE connection_credentials
        SET verified_on = CURRENT_DATE, verdict = $2, verified_ok = $3, verified_at = now()
      WHERE connection = $1`,
    [id, verdict, ok],
  );

  if (updated.rowCount === 0) {
    throw new Error(`connection ${id} holds no credential to verify.`);
  }
}

/**
 * Every connection, in the order a screen shows them.
 *
 * The column list is the guarantee. `ciphertext` is not in it, so no argument
 * to this function and no shape of the result can carry a secret out.
 */
export async function listConnections(client: ClientBase): Promise<Connection[]> {
  const rows = await client.query<Row>(
    `SELECT c.id, c.provider, c.name, c.method, c.services, c.send_from,
            (k.connection IS NOT NULL) AS has_secret,
            k.issued_on, k.expires_on, k.verified_on, k.verdict, k.verified_ok
       FROM connections c
       LEFT JOIN connection_credentials k ON k.connection = c.id
      ORDER BY c.provider, c.name`,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    name: row.name,
    method: row.method,
    services: row.services,
    hasSecret: row.has_secret,
    issuedOn: row.issued_on,
    expiresOn: row.expires_on,
    verifiedOn: row.verified_on,
    verdict: row.verdict,
    verifiedOk: row.verified_ok,
    sendFrom: row.send_from,
  }));
}

/**
 * The stored secret, or null when the connection holds none.
 *
 * This is the only function here that returns a plaintext secret, and the
 * worker calls it at the moment it reaches a provider. Nothing renders what it
 * returns, nothing logs it, and no route returns it.
 *
 * It throws rather than returning null when the bytes will not open. A row
 * that has been altered, or one sealed under a key that has since been
 * rotated, is a stored secret that cannot be used, and that is a different
 * answer from having none.
 */
export async function secretFor(client: ClientBase, id: string): Promise<string | null> {
  const found = await client.query<{ ciphertext: Buffer }>(
    'SELECT ciphertext FROM connection_credentials WHERE connection = $1',
    [id],
  );

  const row = found.rows[0];
  return row === undefined ? null : decrypt(row.ciphertext, id);
}

/** Removes one account. The credential goes with it, by the cascade the
 *  migration declares. */
export async function removeConnection(client: ClientBase, id: string): Promise<void> {
  await client.query('DELETE FROM connections WHERE id = $1', [id]);
}
