/**
 * What the only gate on a self-hosted installation has to do.
 *
 * Every password here is made from random bytes at the moment it is used. A
 * password that looks like one somebody chose is a password somebody will try
 * on a real box, and this file is public.
 *
 * These need no vault and no database, so they run everywhere CI runs.
 */
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { describe, test } from 'node:test';
import { COST, hash, verify } from '../src/auth/password.ts';

/** A password of the length the rules ask for, that nobody has ever typed. */
function password(): string {
  return `Aa1!-${randomBytes(18).toString('base64url')}`;
}

/** The median of a set of measurements, which one slow sample cannot move. */
function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function milliseconds(work: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await work();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

describe('hashing a password', () => {
  test('the password that made the hash verifies', async () => {
    const secret = password();
    assert.equal(await verify(secret, await hash(secret)), true);
  });

  test('another password does not', async () => {
    const stored = await hash(password());
    assert.equal(await verify(password(), stored), false);
  });

  test('one character wrong does not', async () => {
    const secret = password();
    const stored = await hash(secret);
    assert.equal(await verify(`${secret}x`, stored), false);
  });

  test('the same password twice gives two different hashes', async () => {
    const secret = password();
    const [first, second] = await Promise.all([hash(secret), hash(secret)]);
    assert.notEqual(first, second, 'two hashes matched, so the salt is not random');
    assert.equal(await verify(secret, second), true);
  });

  test('the hash carries the parameters it was made with', async () => {
    const stored = await hash(password());
    assert.match(stored, new RegExp(`^\\$scrypt\\$ln=${COST.ln},r=${COST.r},p=${COST.p}\\$`));
    assert.equal(stored.split('$').length, 5, 'the format is algorithm, cost, salt, key');
  });
});

describe('raising the cost later', () => {
  // A hash written before the cost went up, encoded here by hand rather than
  // by the module, so the module has to read the numbers out of the string.
  // Verifying it proves an owner is not locked out by an edit to COST.
  test('a hash made at a lower cost still verifies', async () => {
    const secret = password();
    const ln = 14;
    const salt = randomBytes(16);
    const key = scryptSync(secret, salt, 32, { N: 2 ** ln, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
    const stored = `$scrypt$ln=${ln},r=8,p=1$${b64(salt)}$${b64(key)}`;

    assert.ok(ln < COST.ln, 'this test proves nothing unless the cost is the older one');
    assert.equal(await verify(secret, stored), true);
    assert.equal(await verify(password(), stored), false);
  });

  // The key length is a parameter too, and it is the one that bites. A
  // comparison against a key of another length throws rather than answering,
  // so the derivation has to ask for the length the stored hash carries.
  test('a hash carrying a longer key still verifies', async () => {
    const secret = password();
    const salt = randomBytes(16);
    const key = scryptSync(secret, salt, 64, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
    const stored = `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(key)}`;

    assert.equal(await verify(secret, stored), true);
    assert.equal(await verify(password(), stored), false);
  });
});

describe('a password typed on another keyboard', () => {
  // The rules accept any alphabet, and their own check passes a German
  // password. macOS writes that capital as two code points where Linux writes
  // one, and the two spell the same password.
  test('the two spellings of one letter open the same account', async () => {
    const composed = `Ärger-ist!7${randomBytes(9).toString('base64url')}`;
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed, 'the two spellings are the same string');
    assert.equal(await verify(decomposed, await hash(composed)), true);
  });
});

describe('an account that does not exist', () => {
  test('null verifies against nothing', async () => {
    assert.equal(await verify(password(), null), false);
  });

  test('a hash the module did not write is refused', async () => {
    for (const stored of ['', 'not-a-hash', '$scrypt$ln=17,r=8,p=1$$', '$scrypt$ln=99,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
      assert.equal(await verify(password(), stored), false, `${stored} was accepted`);
    }
  });

  // The claim is that a response cannot say which addresses have accounts.
  // A missing account derives a key it throws away, so it costs what a real
  // account costs. The bound is loose on purpose: it is here to catch a
  // rewrite that returns early, which is instant, and a tight bound on a
  // shared runner fails for reasons that have nothing to do with the code.
  test('takes about as long as verifying a real hash', async () => {
    const secret = password();
    const stored = await hash(secret);
    const real: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 3; i++) {
      real.push(await milliseconds(() => verify(secret, stored)));
      missing.push(await milliseconds(() => verify(secret, null)));
    }
    const ratio = median(missing) / median(real);
    assert.ok(
      ratio > 0.5,
      `a missing account cost ${median(missing).toFixed(0)} ms against ${median(real).toFixed(0)} ms, so it can be told apart`
    );
  });
});
