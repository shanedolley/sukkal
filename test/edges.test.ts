import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  type KnownTargets,
  type ResolvedEdge,
  edgeCandidates,
  edgesFor,
  knownTargets,
  resolveTarget,
} from '../src/migrate/edges.ts';
import { readVault } from '../src/migrate/read-vault.ts';
import { vaultPath } from '../src/vault-mapping.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];
const vaultReason = existsSync(vaultPath()) ? false : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('edgeCandidates: what one note names, before resolving it', () => {
  test('one links_to candidate per unique wikilink in the body', () => {
    const candidates = edgeCandidates({
      frontmatter: {},
      body: 'Cites [[a-note]] twice: [[a-note]] again, and once more [[b-note]].',
    });
    assert.deepEqual(candidates, [
      { kind: 'links_to', target: { form: 'wikilink', name: 'a-note' } },
      { kind: 'links_to', target: { form: 'wikilink', name: 'b-note' } },
    ]);
  });

  test('strips an alias and an anchor, matching scripts/check.py', () => {
    const candidates = edgeCandidates({
      frontmatter: {},
      body: 'See [[a-note|the note]] and [[a-note#a-heading]].',
    });
    assert.deepEqual(candidates, [
      { kind: 'links_to', target: { form: 'wikilink', name: 'a-note' } },
    ]);
  });

  test('one derived_from candidate per sources: entry, in order', () => {
    const candidates = edgeCandidates({
      frontmatter: {
        sources: [
          '[[a-source]], read on 20 August 2026',
          'https://example.com/page',
          'Shane, 20 August 2026',
        ],
      },
      body: '',
    });
    assert.deepEqual(candidates, [
      { kind: 'derived_from', target: { form: 'wikilink', name: 'a-source' } },
      { kind: 'derived_from', target: { form: 'url', url: 'https://example.com/page' } },
      { kind: 'derived_from', target: { form: 'text', text: 'Shane, 20 August 2026' } },
    ]);
  });

  test('a scalar sources: value counts as one entry', () => {
    const candidates = edgeCandidates({ frontmatter: { sources: 'https://example.com' }, body: '' });
    assert.deepEqual(candidates, [
      { kind: 'derived_from', target: { form: 'url', url: 'https://example.com' } },
    ]);
  });

  test('no sources: field produces no derived_from candidates', () => {
    assert.deepEqual(edgeCandidates({ frontmatter: {}, body: 'no links here' }), []);
  });
});

describe('resolveTarget: what a candidate resolves to', () => {
  const known: KnownTargets = knownTargets(
    [{ file: 'koinon/a-fact.md' }],
    [{ file: 'sources/collibra/a-source.md' }],
  );

  test('a wikilink naming a fact resolves to that fact\'s path', () => {
    assert.deepEqual(resolveTarget({ form: 'wikilink', name: 'a-fact' }, known), {
      kind: 'fact', path: 'koinon/a-fact.md',
    });
  });

  test('a wikilink naming a source resolves to that source\'s path', () => {
    assert.deepEqual(resolveTarget({ form: 'wikilink', name: 'a-source' }, known), {
      kind: 'source', path: 'sources/collibra/a-source.md',
    });
  });

  test('a wikilink naming neither becomes unresolved, holding the raw name', () => {
    assert.deepEqual(resolveTarget({ form: 'wikilink', name: 'missing-note' }, known), {
      kind: 'unresolved', ref: 'missing-note',
    });
  });

  test('a url stays a url', () => {
    assert.deepEqual(resolveTarget({ form: 'url', url: 'https://example.com' }, known), {
      kind: 'url', ref: 'https://example.com',
    });
  });

  test('prose with no link or url becomes unresolved, holding the whole entry', () => {
    assert.deepEqual(resolveTarget({ form: 'text', text: 'Shane, 20 August 2026' }, known), {
      kind: 'unresolved', ref: 'Shane, 20 August 2026',
    });
  });
});

describe('edgesFor: a fixture note linking a real note, a missing note and a source', { skip: vaultReason }, () => {
  test('produces three edges of the right kinds, the missing one reported', async () => {
    const report = await readVault();
    const known = knownTargets(report.facts, report.sources);

    const edges = edgesFor(
      {
        frontmatter: {
          sources: ['[[bhp-dlm-demo-transcript-2026-08-21]], the demo transcript'],
        },
        body: 'See [[koinon-clients]] and [[this-note-does-not-exist]] for more.',
      },
      known,
    );

    const expected: ResolvedEdge[] = [
      { kind: 'links_to', target: { kind: 'fact', path: 'koinon/koinon-clients.md' } },
      { kind: 'links_to', target: { kind: 'unresolved', ref: 'this-note-does-not-exist' } },
      {
        kind: 'derived_from',
        target: { kind: 'source', path: 'sources/collibra/bhp-dlm-demo-transcript-2026-08-21.md' },
      },
    ];
    assert.deepEqual(edges, expected);
  });
});

describe('against the frozen vault, compared with scripts/check.py', { skip: vaultReason }, () => {
  test('every wikilink resolves except the nine citing [[index]], a root page outside the registry', async () => {
    const report = await readVault();
    const known = knownTargets(report.facts, report.sources);

    let unresolvedWikilinks = 0;
    const targets = new Set<string>();
    for (const fact of report.facts) {
      for (const candidate of edgeCandidates(fact)) {
        if (candidate.target.form !== 'wikilink') {
          continue;
        }
        const resolved = resolveTarget(candidate.target, known);
        if (resolved.kind === 'unresolved') {
          unresolvedWikilinks += 1;
          targets.add(candidate.target.name);
        }
      }
    }

    // scripts/check.py reports zero broken links today because it treats the
    // vault's root pages as valid targets by filename. The registry has no
    // node kind for a root page -- only fact, source and entity are ingested
    // -- so a link to one resolves unresolved here. [[index]] is the only
    // root page the frozen vault cites, nine times across body and
    // sources:, and docs/adr/0019-a-root-page-is-not-a-node.md keeps it that
    // way.
    //
    // Nine is not the diff KPA-13 will see. All nine cost the two reports no
    // line: test/problems.test.ts proves zero broken links on both sides,
    // and test/advisories.test.ts pins the whole drift at two orphans, which
    // come from a root page's outbound links rather than from these.
    assert.equal(unresolvedWikilinks, 9, `expected 9 links to a root page, found ${unresolvedWikilinks}`);
    assert.deepEqual(targets, new Set(['index']));
  });
});

describe('edges against the registry', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  beforeEach(async () => {
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM facts');
    await client.query('DELETE FROM sources');
    await client.query('DELETE FROM nodes');
  });

  /** Both statements in one transaction, per the node registry. */
  async function fact(over: { path: string; title?: string }): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state)
       VALUES ($1, $2, 'reference', $3, 'one line', 'shared', 'proposed')`,
      [id, over.path, over.title ?? over.path],
    );
    await client.query('COMMIT');
    return id;
  }

  test('a links_to edge to a real fact commits', async () => {
    const fromId = await fact({ path: 'shared/from.md' });
    const toId = await fact({ path: 'shared/to.md' });

    await client.query('BEGIN');
    await client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [
      fromId, toId, 'links_to',
    ]);
    await client.query('COMMIT');

    const rows = await client.query('SELECT kind FROM edges WHERE from_id = $1', [fromId]);
    assert.equal(rows.rows[0]?.kind, 'links_to');
  });

  test('an unresolved node needs no child row, and commits alongside its edge', async () => {
    const fromId = await fact({ path: 'shared/from.md' });

    await client.query('BEGIN');
    const target = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind, ref) VALUES ('unresolved', 'missing-note') RETURNING id",
    );
    await client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [
      fromId, target.rows[0]!.id, 'links_to',
    ]);
    await client.query('COMMIT');

    const rows = await client.query('SELECT ref FROM nodes WHERE kind = $1', ['unresolved']);
    assert.equal(rows.rows[0]?.ref, 'missing-note');
  });

  test('a url node needs no child row either', async () => {
    const fromId = await fact({ path: 'shared/from.md' });

    await client.query('BEGIN');
    const target = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind, ref) VALUES ('url', 'https://example.com') RETURNING id",
    );
    await client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [
      fromId, target.rows[0]!.id, 'derived_from',
    ]);
    await client.query('COMMIT');

    const rows = await client.query('SELECT ref FROM nodes WHERE kind = $1', ['url']);
    assert.equal(rows.rows[0]?.ref, 'https://example.com');
  });

  test('a fact node with no facts row is refused, but only at commit', async () => {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
    assert.ok(node.rows[0]?.id, 'the insert itself succeeds; the trigger is deferred');
    await assert.rejects(client.query('COMMIT'), /has kind fact and no fact row to match it/);
    await client.query('ROLLBACK');
  });

  test('edge_kind admits no fourth value', async () => {
    const fromId = await fact({ path: 'shared/from.md' });
    const toId = await fact({ path: 'shared/to.md' });
    await client.query('BEGIN');
    await assert.rejects(
      client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [
        fromId, toId, 'mentions',
      ]),
      /invalid input value for enum edge_kind/,
    );
    await client.query('ROLLBACK');
  });

  test('a url or unresolved node without ref is refused; a claimed node with ref is refused', async () => {
    await assert.rejects(
      client.query("INSERT INTO nodes (kind) VALUES ('url')"),
      /nodes_ref_suits_kind/,
    );
    await assert.rejects(
      client.query("INSERT INTO nodes (kind, ref) VALUES ('fact', 'should be null')"),
      /nodes_ref_suits_kind/,
    );
  });
});

describe(
  'backlinks: a query over edges, for a real target in the frozen vault',
  { skip: vaultReason || (url ? false : 'DATABASE_URL_TEST is unset') },
  () => {
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

    test('the facts linking [[collibra-customers]] are the ones grep finds in the frozen vault', async () => {
      const report = await readVault();
      const known = knownTargets(report.facts, report.sources);
      const nodeIdByPath = new Map<string, string>();

      await client.query('BEGIN');

      for (const source of report.sources) {
        const node = await client.query<{ id: string }>(
          "INSERT INTO nodes (kind) VALUES ('source') RETURNING id",
        );
        const id = node.rows[0]!.id;
        nodeIdByPath.set(source.file, id);
        await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
          id, source.file, source.body,
        ]);
      }

      for (const fact of report.facts) {
        const node = await client.query<{ id: string }>(
          "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
        );
        const id = node.rows[0]!.id;
        nodeIdByPath.set(fact.file, id);
        await client.query(
          `INSERT INTO facts (id, path, type, title, description, space, state)
           VALUES ($1, $2, $3, $4, $5, $6, 'proposed')`,
          [
            id, fact.file, fact.frontmatter['type'], fact.frontmatter['title'],
            fact.frontmatter['description'], fact.space,
          ],
        );
      }

      for (const fact of report.facts) {
        const fromId = nodeIdByPath.get(fact.file)!;
        for (const edge of edgesFor(fact, known)) {
          let toId: string;
          if (edge.target.kind === 'fact' || edge.target.kind === 'source') {
            toId = nodeIdByPath.get(edge.target.path)!;
          } else {
            const target = await client.query<{ id: string }>(
              'INSERT INTO nodes (kind, ref) VALUES ($1, $2) RETURNING id',
              [edge.target.kind, edge.target.ref],
            );
            toId = target.rows[0]!.id;
          }
          await client.query(
            'INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [fromId, toId, edge.kind],
          );
        }
      }

      await client.query('COMMIT');

      // Backlinks read as a join over edges. No second table stores them.
      const backlinks = await client.query<{ path: string }>(
        `SELECT src.path
           FROM edges e
           JOIN facts target ON target.id = e.to_id
           JOIN facts src ON src.id = e.from_id
          WHERE target.path = 'collibra/collibra-customers.md'
          ORDER BY src.path`,
      );

      // Ground truth: grep -rl '\[\[collibra-customers\]\]' across the frozen
      // vault's four spaces, run against commit da7afce.
      assert.deepEqual(backlinks.rows.map((row) => row.path), [
        'collibra/bhp-dlm-meridian.md',
        'collibra/bhp-unstructured-declined.md',
        'collibra/collibra-people.md',
        'koinon/koinon-clients.md',
      ]);
    });
  },
);
