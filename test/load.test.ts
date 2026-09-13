import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';

import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { indexQuestions, loadVault } from '../src/migrate/load.ts';
import type { FactNote, SourceNote } from '../src/migrate/read-vault.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

function fact(file: string, over: { frontmatter?: Record<string, string | string[]>; body?: string } = {}): FactNote {
  return {
    file,
    space: file.split('/')[0] as FactNote['space'],
    state: 'proposed',
    body: over.body ?? '',
    frontmatter: {
      type: 'reference',
      title: `Title of ${file}`,
      description: 'A description.',
      space: file.split('/')[0]!,
      status: 'stable',
      generated: '2026-08-23',
      generated_by: 'human:shane',
      ...over.frontmatter,
    },
  };
}

const source = (file: string): SourceNote => ({ file, frontmatter: {}, body: `raw ${file}` });

const INDEX = `# Memory

## Questions for you

| Note | Question | Your answer | Asked |
| --- | --- | --- | --- |
| [[a]] | Who runs it? | Nigel does. | 2026-08-24 |
| [[b]] | Did they buy? |  | 2026-08-25 |

## Decisions

| Note | Proposal | Why | Your call | Raised |
|---|---|---|---|---|
| [[a]] | Merge it | Duplicate | no | 2026-08-30 |
`;

describe('the questions on index.md', () => {
  test('each row of the one table, and nothing from the header, the separator or the next table', () => {
    assert.deepEqual(indexQuestions(INDEX), [
      { note: 'a', question: 'Who runs it?', answer: 'Nigel does.', asked: '2026-08-24' },
      { note: 'b', question: 'Did they buy?', answer: '', asked: '2026-08-25' },
    ]);
  });

  test('an index with no such table holds no questions', () => {
    assert.deepEqual(indexQuestions('# Memory\n\n## Decisions\n\n| a | b |\n|---|---|\n| x | y |\n'), []);
  });
});

describe('loading the vault', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    for (const table of ['needs_you', 'tasks', 'edges', 'facts', 'sources', 'nodes']) {
      await client.query(`DELETE FROM ${table}`);
    }
  });

  async function count(sql: string): Promise<number> {
    const result = await client.query<{ n: string }>(sql);
    return Number(result.rows[0]!.n);
  }

  test('writes every kind of row and returns what it wrote', async () => {
    const loaded = await loadVault(
      client,
      {
        facts: [
          fact('koinon/a.md', {
            frontmatter: { sources: ['[[t]], a call', 'https://example.com/x'], tags: ['one', 'two'] },
            body: 'See [[b]].\n- [ ] Chase it 📅 2026-09-30\n- [x] Done it ✅ 2026-09-01',
          }),
          fact('collibra/b.md'),
        ],
        sources: [source('sources/koinon/t.md')],
      },
      INDEX,
    );

    assert.deepEqual(loaded, { facts: 2, sources: 1, tasks: 2, questions: 2, edges: 3 });
    assert.equal(await count('SELECT count(*) AS n FROM facts'), 2);
    assert.equal(await count('SELECT count(*) AS n FROM sources'), 1);
    assert.equal(await count('SELECT count(*) AS n FROM tasks'), 2);
    assert.equal(await count("SELECT count(*) AS n FROM needs_you WHERE kind = 'question'"), 2);
    assert.equal(await count('SELECT count(*) AS n FROM edges'), 3);
  });

  test('a citation edge keeps its sources: entry, and a link edge keeps none', async () => {
    await loadVault(
      client,
      {
        facts: [
          fact('koinon/a.md', { frontmatter: { sources: ['Shane, answers in [[index]], 23 August 2026'] }, body: 'See [[b]].' }),
          fact('koinon/b.md'),
        ],
        sources: [],
      },
      null,
    );
    const rows = await client.query<{ kind: string; citation: string | null }>(
      'SELECT kind, citation FROM edges ORDER BY kind',
    );
    // ORDER BY an enum follows its declaration, which puts derived_from first.
    assert.deepEqual(rows.rows, [
      { kind: 'derived_from', citation: 'Shane, answers in [[index]], 23 August 2026' },
      { kind: 'links_to', citation: null },
    ]);
  });

  test('a fact starts on the day it was generated, not the day it migrated', async () => {
    await loadVault(client, { facts: [fact('koinon/a.md')], sources: [] }, null);
    const row = await client.query<{ valid_from: string; tags: string[] }>(
      "SELECT valid_from, tags FROM facts WHERE path = 'koinon/a.md'",
    );
    assert.equal(row.rows[0]!.valid_from, '2026-08-23');
  });

  test('frontmatter lands in its columns, lists as arrays and dates as dates', async () => {
    await loadVault(
      client,
      {
        facts: [
          fact('koinon/a.md', {
            frontmatter: { tags: ['one', 'two'], verified: '2026-08-24', verified_by: 'human:shane', stale_after: '2026-11-30' },
          }),
        ],
        sources: [],
      },
      null,
    );
    const row = await client.query<{ tags: string[]; verified: string; verified_by: string; stale_after: string; generated_by: string }>(
      "SELECT tags, verified, verified_by, stale_after, generated_by FROM facts WHERE path = 'koinon/a.md'",
    );
    assert.deepEqual(row.rows[0], {
      tags: ['one', 'two'],
      verified: '2026-08-24',
      verified_by: 'human:shane',
      stale_after: '2026-11-30',
      generated_by: 'human:shane',
    });
  });

  test('a fact linking itself is no edge, where the schema would refuse the row and the whole load', async () => {
    const loaded = await loadVault(client, { facts: [fact('koinon/a.md', { body: 'Back to [[a]].' })], sources: [] }, null);
    assert.equal(loaded.edges, 0);
  });

  test('one citation text named by two facts is one node, not two', async () => {
    await loadVault(
      client,
      {
        facts: [
          fact('koinon/a.md', { frontmatter: { sources: ['Shane, 20 August 2026'] } }),
          fact('koinon/b.md', { frontmatter: { sources: ['Shane, 20 August 2026'] } }),
        ],
        sources: [],
      },
      null,
    );
    assert.equal(await count("SELECT count(*) AS n FROM nodes WHERE kind = 'unresolved'"), 1);
    assert.equal(await count('SELECT count(*) AS n FROM edges'), 2);
  });

  test('an answered question carries its answer, and keeps the day it was asked', async () => {
    await loadVault(client, { facts: [fact('koinon/a.md'), fact('koinon/b.md')], sources: [] }, INDEX);
    const rows = await client.query<{ title: string; detail: string; space: string; asked: string }>(
      "SELECT title, detail, space, raised_at::date::text AS asked FROM needs_you ORDER BY raised_at",
    );
    assert.deepEqual(rows.rows[0], {
      title: 'Title of koinon/a.md',
      detail: 'Who runs it?\n\nAnswered on index.md: Nigel does.',
      space: 'koinon',
      asked: '2026-08-24',
    });
    assert.equal(rows.rows[1]!.detail, 'Did they buy?');
  });

  test('a question on a note that is no fact fails the load and leaves nothing behind', async () => {
    await assert.rejects(
      loadVault(client, { facts: [fact('koinon/a.md')], sources: [] }, INDEX),
      /\[\[b\]\], which is no fact/,
    );
    assert.equal(await count('SELECT count(*) AS n FROM facts'), 0, 'the transaction rolled back');
    assert.equal(await count('SELECT count(*) AS n FROM nodes'), 0);
  });

  test('refuses a database that already holds memory, names it, and writes nothing more', async () => {
    await loadVault(client, { facts: [fact('koinon/a.md')], sources: [source('sources/x.md')] }, null);
    await assert.rejects(
      loadVault(client, { facts: [fact('koinon/b.md')], sources: [] }, null),
      /already holds memory: 1 facts, 1 sources and 2 nodes/,
    );
    assert.equal(await count('SELECT count(*) AS n FROM facts'), 1);
  });
});
