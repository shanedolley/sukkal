/**
 * The one place a password becomes a hash, and the one place a hash is
 * checked against a password.
 *
 * On Shane's box Cloudflare Access authenticates the person before the request
 * arrives. On an installation somebody else runs there is no tunnel and no
 * Access, so this is the only gate in front of three mailboxes. ADR-0009 made
 * that trade; ADR-0020 chose the algorithm and the numbers below.
 *
 * The four rules a password has to clear live in `apps/web/lib/password.ts`
 * and are stated nowhere else, this file included. A password that reaches
 * here has already been measured, and hashing is not the place to argue with
 * the answer: a hash that refused a password the form accepted would lock an
 * owner out of their own installation.
 *
 * Nothing here touches the database. The caller hands over the stored hash, or
 * hands over null when no account matched, which keeps this module free of a
 * schema and lets the test run with no server at all.
 */
import type { ScryptOptions } from 'node:crypto';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * scrypt, waited on rather than called back.
 *
 * `promisify` would do this, and its types drop the options argument, which is
 * the argument carrying the cost. Five lines here keep the cost typed.
 */
function derive(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/**
 * What one hash costs, and why these three numbers.
 *
 * `ln` is the base-2 logarithm of scrypt's N, so 17 means N is 131072 and one
 * derivation claims 128 * N * r bytes, which is 128 MiB. Measured on
 * amaterasu, one hash takes roughly 250 milliseconds on an idle box and
 * roughly 520 while a transcode holds all twelve threads. That is the cost
 * OWASP names for scrypt, and a login is rare enough on a one-owner
 * installation to pay it. ADR-0020 records what was measured and what was
 * rejected.
 *
 * Raising these numbers later is safe. Every hash carries the parameters it
 * was made with, so an old hash keeps verifying at the cost it was made at,
 * and only a new hash pays the new one.
 */
export const COST = { ln: 17, r: 8, p: 1 } as const;

/** Bytes of salt. Sixteen is what the scrypt paper and every port of it use. */
const SALT_BYTES = 16;

/** Bytes of derived key. Thirty-two matches the SHA-256 the KDF is built on. */
const KEY_BYTES = 32;

/**
 * The most memory one derivation may claim, which is also the guard on a
 * stored hash.
 *
 * Node refuses a derivation whose memory exceeds `maxmem` and defaults that to
 * 32 MiB, a quarter of what the cost above needs, so a figure has to be passed
 * on every call. The same figure refuses a stored hash that names a larger
 * cost than this: a row holding `ln=24` would otherwise ask for 16 GiB and
 * take the box down, and the row is read from a database rather than written
 * here.
 *
 * It is therefore the real limit on `COST`, and it binds before `ln` reaches
 * 19 at the block size above. Raising `COST` past that means raising this in
 * the same commit, or the module refuses hashes it wrote itself.
 */
const MEMORY_CEILING = 512 * 1024 * 1024;

/**
 * How an encoded hash is written and read.
 *
 * This is the PHC string format, the one shared by argon2 and by every scrypt
 * implementation that stores its own parameters. Reading the cost out of the
 * hash rather than out of a constant is what makes raising the cost cheap. The
 * base64 carries no padding, which the format omits and `Buffer.from` does not
 * need.
 */
const FORMAT = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Cost {
  ln: number;
  r: number;
  p: number;
}

interface Stored extends Cost {
  salt: Buffer;
  key: Buffer;
}

function options({ ln, r, p }: Cost): ScryptOptions {
  return { N: 2 ** ln, r, p, maxmem: MEMORY_CEILING };
}

function b64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

/**
 * The form a password is hashed in, whatever the keyboard produced.
 *
 * The rules invite a password in any alphabet, and `Ärger-ist!7schlimm` is one
 * of the passwords their own check accepts. macOS and Linux disagree about
 * whether that Ä is one code point or two, and the two spellings hash to
 * different keys. Normalising both ends of the comparison means the password
 * that was typed on one machine still opens the account from another.
 */
function normalise(password: string): string {
  return password.normalize('NFC');
}

/**
 * Reads an encoded hash, or returns null when it cannot be trusted.
 *
 * Every field is checked. `Number` gives NaN for anything the pattern let
 * through, and NaN fails every comparison below, so a malformed cost is
 * refused by the same lines that refuse an unreasonable one.
 */
function parse(stored: string): Stored | null {
  const match = FORMAT.exec(stored);
  if (match === null) return null;

  const ln = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (!(ln >= 1 && r >= 1 && p >= 1)) return null;
  if (128 * r * (2 ** ln + p) > MEMORY_CEILING) return null;

  const salt = Buffer.from(match[4] ?? '', 'base64');
  const key = Buffer.from(match[5] ?? '', 'base64');
  if (salt.length < 8 || key.length < 16 || key.length > 64) return null;

  return { ln, r, p, salt, key };
}

/** Hashes `password` with a fresh salt, at the cost above. */
export async function hash(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(normalise(password), salt, KEY_BYTES, options(COST));
  return `$scrypt$ln=${COST.ln},r=${COST.r},p=${COST.p}$${b64(salt)}$${b64(key)}`;
}

/**
 * Whether `password` made `stored`, taking the same time when it did not.
 *
 * `stored` is null when no account has that email, and a malformed hash is
 * treated as the same answer. Both paths still derive a key and throw it away,
 * because the alternative returns in microseconds and tells a stranger which
 * addresses have accounts on this installation. The salt is random there: it
 * is never compared, and the point of it is the work.
 *
 * The cost comes out of `stored`, never out of `COST`, so raising `COST` leaves
 * every hash written before it verifiable. One consequence is worth naming: for
 * as long as the two differ, the missing-account path costs the new figure and
 * a real account costs the old one. Re-hashing on the next successful sign-in
 * closes that gap, and that belongs to whichever story owns sign-in.
 */
export async function verify(password: string, stored: string | null): Promise<boolean> {
  const parsed = stored === null ? null : parse(stored);
  if (parsed === null) {
    await derive(normalise(password), randomBytes(SALT_BYTES), KEY_BYTES, options(COST));
    return false;
  }
  const key = await derive(normalise(password), parsed.salt, parsed.key.length, options(parsed));
  return timingSafeEqual(key, parsed.key);
}
