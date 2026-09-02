import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  type Candidate,
  admit,
  notAlreadyRecorded,
  retiresWhatItContradicts,
  stillTrueInAMonth,
  verdict,
  worthRecording,
} from '../src/memory/gates.ts';
import { recorded } from '../src/memory/inference.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

const GATE_1 = 'gate-1-still-true-in-a-month';
const GATE_2 = 'gate-2-worth-recording';

/** Both judged gates pass. */
const passes = recorded({
  [GATE_1]: 'PASS: a decision, and decisions keep.',
  [GATE_2]: 'PASS: Shane stated it as a decision.',
});

/** The source every candidate is extracted from. Created once the schema is up. */
let sourceId = '0';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    subjectId: sourceId,
    path: 'shared/a-candidate.md',
    type: 'decision',
    title: 'A candidate decision',
    description: 'one line',
    space: 'shared',
    text: 'Shane decided on 20 August 2026 that the runner refuses rather than guesses.',
    validFrom: '2026-08-20',
    ...over,
  };
}

describe('reading a model answer', () => {
  test('takes a clean pass and a clean fail', () => {
    assert.deepEqual(verdict('PASS: a stated decision.'), {
      pass: true, reason: 'a stated decision.',
    });
    assert.deepEqual(verdict('FAIL - a queue length moves weekly.'), {
      pass: false, reason: 'a queue length moves weekly.',
    });
  });

  test('rejects anything that is neither', () => {
    // A hedge, a refusal, an empty answer and a wrapped verdict all reject.
    for (const answer of [
      'It depends on how you read it.',
      'I cannot answer that.',
      '',
      'Probably PASS, but I am not sure.',
    ]) {
      assert.equal(verdict(answer).pass, false, JSON.stringify(answer));
      assert.match(verdict(answer).reason, /unreadable answer/);
    }
  });
});

describe('the gates', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    // A rejection points at the node it concerned, so it needs a real one.
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('source') RETURNING id",
    );
    sourceId = node.rows[0]!.id;
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
      sourceId, 'sources/a-transcript.md', 'raw',
    ]);
    await client.query('COMMIT');
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM rejections');
    await client.query('DELETE FROM facts');
    await client.query("DELETE FROM nodes WHERE kind = 'fact'");
  });

  /**
   * Writes a live fact straight in, bypassing the gates.
   *
   * Both statements go in one transaction. The registry's deferred trigger
   * rejects a committed node with no child row, which is the point of it.
   */
  async function existing(over: { path: string; title: string; validFrom?: string }) {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, $2, 'decision', $3, 'one line', 'shared', 'proposed', $4)`,
      [id, over.path, over.title, over.validFrom ?? '2026-01-01'],
    );
    await client.query('COMMIT');
    return id;
  }

  describe('gate 1, still true in a month', () => {
    const gate = (answer: string) =>
      stillTrueInAMonth(recorded({ [GATE_1]: answer }))(candidate());

    test('passes a durable claim', async () => {
      assert.equal((await gate('PASS: a contract term.')).pass, true);
    });

    test('fails a passing state', async () => {
      assert.equal((await gate('FAIL: a queue length.')).pass, false);
    });

    test('rejects at the boundary, where the model will not commit', async () => {
      // The prompt says an undecidable case fails. A hedge reaches here as an
      // error, and an error rejects.
      const result = await gate('It could go either way.');
      assert.equal(result.pass, false);
      assert.match(result.reason, /unreadable answer/);
    });

    test('rejects when no answer was recorded at all', async () => {
      await assert.rejects(stillTrueInAMonth(recorded({}))(candidate()), /no recorded answer/);
    });
  });

  describe('gate 2, worth recording', () => {
    const gate = (answer: string) =>
      worthRecording(recorded({ [GATE_2]: answer }))(candidate());

    test('passes something Shane stated once as a decision', async () => {
      assert.equal((await gate('PASS: stated once as a decision.')).pass, true);
    });

    test('fails a single passing mention by somebody else', async () => {
      assert.equal((await gate('FAIL: mentioned once, in passing.')).pass, false);
    });

    test('rejects at the boundary, one sighting and no authority', async () => {
      assert.equal((await gate('FAIL: seen once, and not from Shane.')).pass, false);
    });
  });

  describe('gate 3, nothing already records it', () => {
    test('rejects a candidate duplicating a live fact', async () => {
      await existing({ path: 'shared/already.md', title: 'A candidate decision' });
      const result = await notAlreadyRecorded(client)(candidate());
      assert.equal(result.pass, false);
      assert.match(result.reason, /already recorded by shared\/already\.md/);
    });

    test('passes a candidate that merely mentions the same entity', async () => {
      await existing({ path: 'shared/bhp.md', title: 'BHP retention estate' });
      const result = await notAlreadyRecorded(client)(
        candidate({ title: 'BHP disposal control, two person' }),
      );
      assert.equal(result.pass, true);
    });

    test('passes when the only match is already retired', async () => {
      const id = await existing({ path: 'shared/old.md', title: 'A candidate decision' });
      await client.query("UPDATE facts SET valid_to = '2026-06-01' WHERE id = $1", [id]);
      assert.equal((await notAlreadyRecorded(client)(candidate())).pass, true);
    });
  });

  describe('gate 4, retires what it contradicts', () => {
    test('passes a candidate contradicting nothing', async () => {
      assert.equal((await retiresWhatItContradicts(client)(candidate())).pass, true);
    });

    test('passes when the fact it retires is live', async () => {
      await existing({ path: 'shared/old.md', title: 'The old answer' });
      const result = await retiresWhatItContradicts(client)(
        candidate({ contradicts: ['shared/old.md'] }),
      );
      assert.equal(result.pass, true);
    });

    test('fails when there is nothing live to retire', async () => {
      const result = await retiresWhatItContradicts(client)(
        candidate({ contradicts: ['shared/never-existed.md'] }),
      );
      assert.equal(result.pass, false);
      assert.match(result.reason, /nothing live to retire/);
    });
  });

  describe('admitting a candidate', () => {
    test('writes the fact when all four pass', async () => {
      assert.deepEqual(await admit(client, passes, candidate()), {
        pass: true, reason: 'all four gates passed',
      });
      const written = await client.query<{ path: string }>('SELECT path FROM facts');
      assert.deepEqual(written.rows, [{ path: 'shared/a-candidate.md' }]);
    });

    test('records the reason when a gate fails, naming the gate', async () => {
      const model = recorded({ [GATE_1]: 'FAIL: a queue length moves weekly.' });
      const result = await admit(client, model, candidate());

      assert.equal(result.pass, false);
      assert.equal(result.reason, 'gate 1: a queue length moves weekly.');

      const kept = await client.query<{ reason: string }>('SELECT reason FROM rejections');
      assert.deepEqual(kept.rows, [{ reason: 'gate 1: a queue length moves weekly.' }]);
      assert.equal((await client.query('SELECT 1 FROM facts')).rows.length, 0);
    });

    test('a gate that throws rejects, rather than passing', async () => {
      // No recorded answer, so the gate throws inside admit.
      const result = await admit(client, recorded({}), candidate());
      assert.equal(result.pass, false);
      assert.match(result.reason, /gate 1: threw: no recorded answer/);
    });

    test('does not raise the same candidate twice', async () => {
      const model = recorded({ [GATE_1]: 'FAIL: a queue length moves weekly.' });
      await admit(client, model, candidate());

      // A later run offers the same candidate, and the gates never run again.
      const again = await admit(client, recorded({}), candidate());
      assert.equal(again.pass, false);
      assert.match(again.reason, /raised before and rejected\. gate 1: a queue length/);

      const kept = await client.query('SELECT 1 FROM rejections');
      assert.equal(kept.rows.length, 1, 'the rejection is recorded once, not twice');
    });

    test('retires the contradicted fact in the same transaction', async () => {
      await existing({ path: 'shared/old.md', title: 'The old answer' });
      const result = await admit(client, passes, candidate({ contradicts: ['shared/old.md'] }));
      assert.equal(result.pass, true, result.reason);

      const both = await client.query<{ path: string; valid_to: string | null }>(
        'SELECT path, valid_to FROM facts ORDER BY path',
      );
      assert.equal(both.rows.length, 2);
      assert.equal(both.rows[0]?.path, 'shared/a-candidate.md');
      assert.equal(both.rows[0]?.valid_to, null, 'the replacement is live');
      assert.notEqual(both.rows[1]?.valid_to, null, 'the old answer is retired');

      const edge = await client.query<{ kind: string }>('SELECT kind FROM edges');
      assert.deepEqual(edge.rows, [{ kind: 'supersedes' }]);
    });

    test('a failure between the two writes leaves neither', async () => {
      await existing({ path: 'shared/old.md', title: 'The old answer' });

      // Fail exactly where the retirement happens: after the fact is written,
      // before the old one is retired.
      const real = client.query.bind(client);
      const broken = Object.create(client) as ClientBase;
      broken.query = ((text: unknown, ...rest: unknown[]) => {
        if (typeof text === 'string' && text.startsWith('UPDATE facts SET valid_to')) {
          return Promise.reject(new Error('injected failure'));
        }
        return (real as (...args: unknown[]) => unknown)(text, ...rest);
      }) as ClientBase['query'];

      await assert.rejects(
        admit(broken, passes, candidate({ contradicts: ['shared/old.md'] })),
        /injected failure/,
      );

      const survivors = await client.query<{ path: string; valid_to: string | null }>(
        'SELECT path, valid_to FROM facts',
      );
      assert.deepEqual(
        survivors.rows,
        [{ path: 'shared/old.md', valid_to: null }],
        'the replacement was rolled back, and the old answer stayed live',
      );
    });
  });
});
