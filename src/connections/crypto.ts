/**
 * The one place a connection's secret is sealed, and the one place a sealed
 * secret is opened.
 *
 * A credential reaches an outside system on Shane's behalf. Two of the three
 * mailboxes it reaches hold Collibra customer material, so the bytes at rest
 * are worth more than the row they sit in, and a database backup that leaves
 * the box carries them with it. Sealing them here means the backup carries
 * ciphertext and the key stays behind.
 *
 * WHY NODE'S OWN CRYPTO. ADR-0020 chose scrypt from `node:crypto` for the
 * password hash and gave the reason: this repository has two dependencies,
 * neither of them compiles, and adding one that does puts a build toolchain
 * between somebody and `docker run`. The same reason holds here, and
 * AES-256-GCM needs no help from outside.
 *
 * WHY AUTHENTICATED ENCRYPTION. Whoever can read the row can usually write it.
 * A cipher with no tag lets them change the bytes and watch what breaks, one
 * byte at a time. GCM refuses a ciphertext that has been altered, and the
 * connection id goes in as additional data, so a row's bytes decrypt under
 * that connection and under no other. Moving the Sydney Water secret onto the
 * BHP account then fails rather than succeeding quietly.
 *
 * Nothing here touches the database. The caller hands over bytes and gets bytes
 * back, which keeps this module free of a schema and lets its test run with no
 * server at all.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The variable holding the key, base64, 32 bytes decoded. */
export const KEY_VARIABLE = 'SUKKAL_SECRET_KEY';

/**
 * What a sealed secret is made of, in the order it is written.
 *
 * The version byte comes first so a second algorithm can live beside this one
 * rather than replace it. That is what the `$scrypt$` prefix buys the password
 * hash, and it costs one byte here.
 *
 * Twelve bytes of nonce is what GCM is specified for: longer is hashed down to
 * twelve and shorter buys nothing. It is random on every seal, and a repeat
 * under one key would leak the difference between two secrets, which is why
 * nothing here ever derives a nonce from the row.
 */
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** The shortest thing this module ever wrote: the header of an empty secret. */
export const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;

/**
 * The key, read on every call.
 *
 * It comes from the environment, so it is in `~/.config/sukkal/env` on the Mac
 * and in the unit's `EnvironmentFile` on amaterasu, which is where every other
 * secret already lives. `docs/runbooks/secrets.md` says why that file and not
 * this repository. It never comes from a column: the database holds the
 * ciphertext, and a database holding the key with it protects nobody.
 *
 * Reading it here rather than caching it at import time buys two things. A
 * rotated key takes effect on the next call rather than the next restart, and
 * a test can prove the refusal below by unsetting one variable.
 *
 * Every failure throws, so `encrypt` and `decrypt` refuse to run without a
 * usable key. A store that wrote a secret under a missing key would be a store
 * that wrote it in the clear.
 */
export function key(): Buffer {
  const value = process.env[KEY_VARIABLE];
  if (!value) {
    throw new Error(
      `${KEY_VARIABLE} is unset, so no connection secret can be sealed or read. ` +
        'See docs/runbooks/secrets.md: real values live in ~/.config/sukkal/env. ' +
        "Make one with `openssl rand -base64 32`.",
    );
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `${KEY_VARIABLE} decodes to ${bytes.length} bytes and AES-256 needs ${KEY_BYTES}. ` +
        'Make one with `openssl rand -base64 32`.',
    );
  }

  return bytes;
}

/**
 * Seals `plaintext` against `context`, which the same context alone reopens.
 *
 * `context` is the connection id at every call site. It is authenticated
 * rather than encrypted, so it stays readable in the row and still binds the
 * bytes to it. An empty context is refused: it would authenticate nothing
 * while looking like it authenticated something.
 */
export function encrypt(plaintext: string, context: string): Buffer {
  if (context === '') {
    throw new Error('encrypt needs a context to seal against, and was given none.');
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), sealed]);
}

/**
 * Returns what `sealed` holds, or throws.
 *
 * It throws on a key that cannot open it, on a byte that has changed, on a
 * context that does not match, and on a version this module did not write.
 * Every one of those is a row that is not what it claims to be, and a caller
 * that got an empty string back instead would carry it to a provider and read
 * the refusal as a wrong password.
 */
export function decrypt(sealed: Buffer, context: string): string {
  if (context === '') {
    throw new Error('decrypt needs the context the secret was sealed against.');
  }

  // The key is read before the bytes are measured, so a missing key is
  // reported as a missing key. Checking the shape first told an operator
  // whose key was unset that the row was malformed, which sends them to the
  // database to fix the environment.
  const secret = key();

  if (sealed.length < HEADER_BYTES) {
    throw new Error(
      `a sealed secret is at least ${HEADER_BYTES} bytes and this one is ${sealed.length}.`,
    );
  }
  if (sealed[0] !== VERSION) {
    throw new Error(`sealed secret carries version ${String(sealed[0])}, and this module writes ${VERSION}.`);
  }

  const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
  const tag = sealed.subarray(1 + NONCE_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', secret, nonce);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(sealed.subarray(HEADER_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
