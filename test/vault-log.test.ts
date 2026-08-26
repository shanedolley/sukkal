import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { vaultPath } from '../src/vault-mapping.ts';

/**
 * KPA-18 moved the vault's log.md into docs/vault-log.md whole. The vault's
 * copy is still the original until KPA-14 freezes it, so this compares the
 * two and fails if the copy falls behind.
 */

const COPY = path.join(import.meta.dirname, '..', 'docs', 'vault-log.md');
const ORIGINAL = path.join(vaultPath(), 'log.md');

/** One entry is one `## [date] kind | title` heading. */
function entries(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('## ['));
}

describe('the vault log', () => {
  test('the copy holds fourteen entries', () => {
    assert.equal(entries(readFileSync(COPY, 'utf8')).length, 14);
  });

  describe('against the vault', {
    skip: existsSync(ORIGINAL) ? false : `no log at ${ORIGINAL}. Set VAULT_PATH`,
  }, () => {
    test('every entry in the vault is in the copy, heading for heading', () => {
      const original = entries(readFileSync(ORIGINAL, 'utf8'));
      const copied = entries(readFileSync(COPY, 'utf8'));
      assert.deepEqual(copied, original);
    });

    test('the copy carries the original text unaltered', () => {
      const original = readFileSync(ORIGINAL, 'utf8');
      assert.ok(
        readFileSync(COPY, 'utf8').endsWith(original),
        'docs/vault-log.md must end with the vault log, byte for byte',
      );
    });
  });
});
