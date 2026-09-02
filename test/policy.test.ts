/**
 * The policy engine.
 *
 * The rule that shapes every test below: it denies on failure. An empty table,
 * a database error, an action no rule describes and a malformed row each deny,
 * and each one is proved by causing it rather than by asserting it.
 *
 * Nothing here reads the vault, so this file runs the way CI runs, without one.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  crossed,
  decide,
  DENY_BY_DEFAULT,
  FORBIDDEN,
  PERMITTED,
  SEPARATION,
  type Proposal,
} from '../src/policy/engine.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ENGINE = path.join(import.meta.dirname, '..', 'src', 'policy', 'engine.ts');
const url = process.env['DATABASE_URL_TEST'];

/** A proposal that nothing denies, so each test overrides only what it tests. */
const DRAFT: Proposal = {
  action: 'mail.draft',
  target: 'thread/18f2c9',
  space: 'koinon',
};

describe('the policy engine', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  /** Runs `body` against a change to `policies` that never survives it. */
  async function changing(sql: string, body: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await body();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  describe('a rule is a row', () => {
    test('names no prompt and calls no model, because it imports only the driver', async () => {
      const source = await readFile(ENGINE, 'utf8');
      const imports = [...source.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
      assert.deepEqual(imports, ['pg'], 'the engine may import the driver and nothing else');
      assert.doesNotMatch(source, /prompts|inference|readFile/);
    });

    test('every key it can name is a row policies holds', async () => {
      const keys = [DENY_BY_DEFAULT, SEPARATION, ...new Set(FORBIDDEN.values())];
      const rows = await client.query<{ key: string }>(
        'SELECT key FROM policies WHERE key = ANY($1) ORDER BY key',
        [keys],
      );
      assert.deepEqual(rows.rows.map((r) => r.key).sort(), [...keys].sort());
    });

    test('every key it can name writes straight into audit.rule', async () => {
      // The foreign key and `audit_denial_names_a_rule` are what a denial has
      // to satisfy. Asserting the key looks right proves nothing; inserting it
      // proves the denial is recordable. The rows roll back, because `audit`
      // is append only and this test has no business leaving entries in it.
      await changing('SELECT 1', async () => {
        for (const rule of [DENY_BY_DEFAULT, SEPARATION, ...new Set(FORBIDDEN.values())]) {
          const written = await client.query<{ rule: string }>(
            `INSERT INTO audit (action, intent, before, outcome, result, reverse, space, rule)
             VALUES ('Send mail', 'i', 'b', 'denied', 'r', 'v', 'koinon', $1) RETURNING rule`,
            [rule],
          );
          assert.equal(written.rows[0]?.rule, rule);
        }
      });
    });
  });

  describe('a forbidden action', () => {
    test('denies and names the rule that denied it', async () => {
      for (const [action, rule] of FORBIDDEN) {
        const verdict = await decide(client, { ...DRAFT, action });
        assert.equal(verdict.outcome, 'denied', action);
        assert.equal(verdict.rule, rule, action);
        assert.notEqual(verdict.reason, '');
      }
    });

    test('an absolute rule denies even when enabled is false', async () => {
      await changing(
        "UPDATE policies SET enabled = false WHERE key = 'mail.send.never-unprompted'",
        async () => {
          const verdict = await decide(client, { ...DRAFT, action: 'mail.send' });
          assert.equal(verdict.outcome, 'denied');
          assert.equal(verdict.rule, 'mail.send.never-unprompted');
          assert.match(verdict.reason, /absolute/);
        },
      );
    });

    test('a rule that is not absolute stops denying when enabled is false', async () => {
      // The test beside the one above. Without it, `absolute` could be doing
      // nothing and every rule could be denying because `enabled` is ignored.
      const on = await decide(client, { ...DRAFT, action: 'fact.verify' });
      assert.equal(on.outcome, 'denied');
      assert.equal(on.rule, 'fact.verify.never-by-agent');

      await changing(
        "UPDATE policies SET enabled = false WHERE key = 'fact.verify.never-by-agent'",
        async () => {
          const off = await decide(client, { ...DRAFT, action: 'fact.verify' });
          assert.equal(off.outcome, 'allowed');
          assert.equal(off.rule, null);
        },
      );
    });
  });

  describe('a permitted action', () => {
    test('allows and names no rule', async () => {
      for (const action of PERMITTED) {
        const verdict = await decide(client, { ...DRAFT, action });
        assert.equal(verdict.outcome, 'allowed', action);
        assert.equal(verdict.rule, null, action);
      }
    });
  });

  describe('it denies on failure', () => {
    test('an action no rule describes denies', async () => {
      const verdict = await decide(client, { ...DRAFT, action: 'calendar.cancel' });
      assert.equal(verdict.outcome, 'denied');
      assert.equal(verdict.rule, DENY_BY_DEFAULT);
      assert.match(verdict.reason, /no rule describes the action calendar\.cancel/);
    });

    test('an empty policies table denies', async () => {
      await changing('DELETE FROM policies', async () => {
        const verdict = await decide(client, DRAFT);
        assert.equal(verdict.outcome, 'denied');
        assert.equal(verdict.rule, DENY_BY_DEFAULT);
        assert.match(verdict.reason, /did not load/);
      });
    });

    test('one missing rule denies every action, not just the one it governs', async () => {
      await changing(
        "DELETE FROM policies WHERE key = 'fact.verify.never-by-agent'",
        async () => {
          const verdict = await decide(client, DRAFT);
          assert.equal(verdict.outcome, 'denied');
          assert.match(verdict.reason, /fact\.verify\.never-by-agent is missing/);
        },
      );
    });

    test('a malformed row denies', async () => {
      await changing(
        "UPDATE policies SET effect = '   ' WHERE key = 'mail.send.never-unprompted'",
        async () => {
          const verdict = await decide(client, DRAFT);
          assert.equal(verdict.outcome, 'denied');
          assert.equal(verdict.rule, DENY_BY_DEFAULT);
          assert.match(verdict.reason, /says nothing about what it governs/);
        },
      );
    });

    test('a database error denies', async () => {
      const closed = connect('DATABASE_URL_TEST');
      await closed.connect();
      await closed.end();

      const verdict = await decide(closed, DRAFT);
      assert.equal(verdict.outcome, 'denied');
      assert.equal(verdict.rule, DENY_BY_DEFAULT);
      assert.match(verdict.reason, /did not load/);
    });
  });

  describe('the separation rule', () => {
    test('flags a crossing and never denies it', async () => {
      const verdict = await decide(client, {
        ...DRAFT,
        draws: ['collibra', 'koinon'],
      });
      assert.equal(verdict.outcome, 'allowed');
      assert.equal(verdict.rule, SEPARATION);
      assert.match(verdict.reason, /flagged: draws on collibra and koinon/);
    });

    test('never denies, whichever pair of spaces crossed', async () => {
      const spaces = ['collibra', 'koinon', 'personal', 'shared'] as const;
      for (const one of spaces) {
        for (const two of spaces) {
          const verdict = await decide(client, { ...DRAFT, draws: [one, two] });
          assert.equal(verdict.outcome, 'allowed', `${one} and ${two}`);
        }
      }
    });

    test('a shared citation crosses nothing, per ADR-0018', async () => {
      const verdict = await decide(client, { ...DRAFT, draws: ['collibra', 'shared'] });
      assert.equal(verdict.outcome, 'allowed');
      assert.equal(verdict.rule, null);
      assert.deepEqual(crossed(['collibra', 'shared']), ['collibra']);
    });

    test('a forbidden action that also crosses still denies', async () => {
      const verdict = await decide(client, {
        ...DRAFT,
        action: 'mail.send',
        draws: ['collibra', 'koinon'],
      });
      assert.equal(verdict.outcome, 'denied');
      assert.equal(verdict.rule, 'mail.send.never-unprompted');
    });

    test('switching it off stops the flag and still allows', async () => {
      await changing(
        `UPDATE policies SET enabled = false WHERE key = '${SEPARATION}'`,
        async () => {
          const verdict = await decide(client, { ...DRAFT, draws: ['collibra', 'koinon'] });
          assert.equal(verdict.outcome, 'allowed');
          assert.equal(verdict.rule, null);
        },
      );
    });
  });
});
