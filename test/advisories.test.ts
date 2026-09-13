import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { advisories, crossSpaceLinks, orphans, reviewPileUp, uncompiledSources } from '../src/checks/advisories.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { edgesFor, knownTargets } from '../src/migrate/edges.ts';
import { readVault } from '../src/migrate/read-vault.ts';
import { vaultPath } from '../src/vault-mapping.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];
const vaultReason = existsSync(vaultPath()) ? false : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('the four advisories', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM facts');
    await client.query('DELETE FROM sources');
    await client.query('DELETE FROM nodes');
  });

  /** A live fact, valid from a fixed early date so a later `valid_to` in a
   *  retirement fixture never falls foul of `facts_valid_range`. Both
   *  statements in one transaction, per the node registry. */
  async function fact(over: {
    path: string;
    space?: string;
    verified?: string | null;
    staleAfter?: string | null;
  }): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state,
                          valid_from, verified, verified_by, stale_after)
       VALUES ($1, $2, 'reference', $2, 'one line', $3, 'proposed', '2026-01-01', $4, $5, $6)`,
      [
        id,
        over.path,
        over.space ?? 'shared',
        over.verified === undefined ? null : over.verified,
        over.verified ? 'human:shane' : null,
        over.staleAfter ?? null,
      ],
    );
    await client.query('COMMIT');
    return id;
  }

  /** A source. Same registry rule as `fact`. */
  async function source(sourcePath: string): Promise<string> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('source') RETURNING id");
    const id = node.rows[0]!.id;
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [id, sourcePath, 'raw']);
    await client.query('COMMIT');
    return id;
  }

  async function link(fromId: string, toId: string, kind: 'links_to' | 'derived_from' = 'links_to') {
    await client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [fromId, toId, kind]);
  }

  describe('orphans: facts nothing links to', () => {
    test('a fact with no inbound edge is reported', async () => {
      await fact({ path: 'koinon/lonely.md', space: 'koinon' });
      assert.deepEqual(await orphans(client), ['orphan: koinon/lonely.md is linked from nowhere']);
    });

    test('a fact with an inbound edge is not reported, only the one nothing points at', async () => {
      const a = await fact({ path: 'koinon/a.md', space: 'koinon' });
      const b = await fact({ path: 'koinon/b.md', space: 'koinon' });
      await link(a, b);
      // a.md links out but nothing links to it, so it is still an orphan;
      // b.md is the one this test is about.
      assert.deepEqual(await orphans(client), ['orphan: koinon/a.md is linked from nowhere']);
    });

    test('shared/ is exempt: unlinked and still not reported', async () => {
      await fact({ path: 'shared/policy.md', space: 'shared' });
      assert.deepEqual(await orphans(client), []);
    });
  });

  describe('crossSpaceLinks: links crossing the Collibra/Koinon wall', () => {
    test('a koinon fact linking a collibra fact is flagged, message text matching check.py', async () => {
      const koinon = await fact({ path: 'koinon/c.md', space: 'koinon' });
      const collibra = await fact({ path: 'collibra/d.md', space: 'collibra' });
      await link(koinon, collibra);

      assert.deepEqual(await crossSpaceLinks(client), [
        'crosses spaces: koinon/c.md links collibra/d. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
      ]);
    });

    test('a link through shared is not a crossing', async () => {
      const koinon = await fact({ path: 'koinon/c.md', space: 'koinon' });
      const shared = await fact({ path: 'shared/s.md', space: 'shared' });
      await link(koinon, shared);
      assert.deepEqual(await crossSpaceLinks(client), []);
    });

    test('a link within the same space is not a crossing', async () => {
      const a = await fact({ path: 'koinon/a.md', space: 'koinon' });
      const b = await fact({ path: 'koinon/b.md', space: 'koinon' });
      await link(a, b);
      assert.deepEqual(await crossSpaceLinks(client), []);
    });
  });

  describe('uncompiledSources: the ratio cited by no fact', () => {
    test('an uncited source is counted, an cited one is not', async () => {
      const cited = await source('sources/example/cited.md');
      await source('sources/example/uncited.md');
      const f = await fact({ path: 'shared/f.md', space: 'shared' });
      await link(f, cited, 'derived_from');

      assert.deepEqual(await uncompiledSources(client), [
        'uncompiled sources: 1 of 2 are cited by no fact. ' +
          'Most bulk imports never should be; a recent one that is not, is worth a look.',
      ]);
    });

    test('no sources at all reports nothing, matching check.py\'s "if uncompiled and sources"', async () => {
      assert.deepEqual(await uncompiledSources(client), []);
    });
  });

  describe('reviewPileUp: too many facts falling due on one day', () => {
    test('four facts sharing a stale_after date are flagged', async () => {
      for (const p of ['a', 'b', 'c', 'd']) {
        await fact({ path: `shared/${p}.md`, verified: '2026-01-01', staleAfter: '2026-09-30' });
      }
      assert.deepEqual(await reviewPileUp(client), [
        'review pile-up: 4 notes fall due on 2026-09-30, more than one run clears',
      ]);
    });

    test('three sharing a date is the nightly\'s capacity, not a pile-up', async () => {
      for (const p of ['a', 'b', 'c']) {
        await fact({ path: `shared/${p}.md`, verified: '2026-01-01', staleAfter: '2026-09-30' });
      }
      assert.deepEqual(await reviewPileUp(client), []);
    });

    test('an unverified fact never counts towards a pile-up', async () => {
      for (const p of ['a', 'b', 'c', 'd']) {
        await fact({ path: `shared/${p}.md`, verified: null, staleAfter: '2026-09-30' });
      }
      assert.deepEqual(await reviewPileUp(client), []);
    });

    test('a retired fact never counts towards a pile-up', async () => {
      for (const p of ['a', 'b', 'c']) {
        await fact({ path: `shared/${p}.md`, verified: '2026-01-01', staleAfter: '2026-09-30' });
      }
      const id = await fact({ path: 'shared/d.md', verified: '2026-01-01', staleAfter: '2026-09-30' });
      await client.query("UPDATE facts SET valid_to = '2026-06-01' WHERE id = $1", [id]);
      assert.deepEqual(await reviewPileUp(client), []);
    });
  });

  describe('advisories: all four, and never a failure', () => {
    test('combines the four in check.py\'s order', async () => {
      await fact({ path: 'koinon/lonely.md', space: 'koinon' });
      const koinon = await fact({ path: 'koinon/c.md', space: 'koinon' });
      const collibra = await fact({ path: 'collibra/d.md', space: 'collibra' });
      await link(koinon, collibra);
      await source('sources/example/uncited.md');

      const found = await advisories(client);
      assert.deepEqual(found, [
        // koinon/c.md is an orphan too: it links out to collibra/d.md, but
        // nothing links to koinon/c.md itself. The two facts are ordered by
        // path.
        'orphan: koinon/c.md is linked from nowhere',
        'orphan: koinon/lonely.md is linked from nowhere',
        'crosses spaces: koinon/c.md links collibra/d. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'uncompiled sources: 1 of 1 are cited by no fact. ' +
          'Most bulk imports never should be; a recent one that is not, is worth a look.',
      ]);
    });

    test('an advisory reports and changes nothing: the rows it read are untouched', async () => {
      await fact({ path: 'koinon/lonely.md', space: 'koinon' });
      await advisories(client);
      const rows = await client.query('SELECT count(*) AS n FROM facts');
      assert.equal(rows.rows[0]?.n, '1', 'advisories() must not write');
    });

    // A stale fact -- and every advisory -- is deliberately typed to return
    // string[], not a pass/fail. There is no failure path to exercise: this
    // function has no return value that could signal one.
  });
});

describe(
  'against the frozen vault, reproducing check.py\'s numbers',
  { skip: vaultReason || (url ? false : 'DATABASE_URL_TEST is unset') },
  () => {
    let client: ClientBase & { end: () => Promise<void> };

    before(async () => {
      client = connect('DATABASE_URL_TEST');
      await client.connect();
      await refuseProduction(client);
      await down(client, MIGRATIONS);
      await up(client, MIGRATIONS);

      const report = await readVault();
      const known = knownTargets(report.facts, report.sources);
      const nodeIdByPath = new Map<string, string>();

      await client.query('BEGIN');

      for (const s of report.sources) {
        const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('source') RETURNING id");
        const id = node.rows[0]!.id;
        nodeIdByPath.set(s.file, id);
        await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [id, s.file, s.body]);
      }

      for (const f of report.facts) {
        const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
        const id = node.rows[0]!.id;
        nodeIdByPath.set(f.file, id);
        await client.query(
          `INSERT INTO facts (id, path, type, title, description, space, state)
           VALUES ($1, $2, $3, $4, $5, $6, 'proposed')`,
          [id, f.file, f.frontmatter['type'], f.frontmatter['title'], f.frontmatter['description'], f.space],
        );
      }

      for (const f of report.facts) {
        const fromId = nodeIdByPath.get(f.file)!;
        for (const edge of edgesFor(f, known)) {
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
    });

    after(async () => {
      await down(client, MIGRATIONS);
      await client.end();
    });

    // Ground truth: `scripts/check.py --review`, run against the frozen
    // vault at commit da7afce (docs/vault-freeze.txt), on 2 September 2026.
    // It reports four "crosses spaces" lines and one "uncompiled sources"
    // line -- not the three cross-space links the story that set up this
    // fixture recalled; this run and two repeats of it agree on four, and
    // the vault's HEAD still matches the recorded freeze commit. The
    // uncompiled-sources figure, 31 of 32, does match what was recalled.
    test('cross-space links: 4, matching a fresh run of check.py --review, not the 3 recalled', async () => {
      assert.deepEqual(await crossSpaceLinks(client), [
        'crosses spaces: collibra/collibra-customers.md links koinon/koinon-clients. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: collibra/collibra-people.md links koinon/koinon-people. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: koinon/koinon-clients.md links collibra/collibra-customers. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: koinon/koinon-people.md links collibra/collibra-people. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
      ]);
    });

    test('uncompiled sources: 31 of 32, matching check.py exactly', async () => {
      assert.deepEqual(await uncompiledSources(client), [
        'uncompiled sources: 31 of 32 are cited by no fact. ' +
          'Most bulk imports never should be; a recent one that is not, is worth a look.',
      ]);
    });

    // check.py reports zero orphans today. This reports two, and
    // docs/adr/0019-a-root-page-is-not-a-node.md decided to keep them. Both
    // notes are linked only from a root page (log.md and index.md), which
    // check.py scans for outbound links and this port does not, because a
    // root page belongs to none of the memory's three layers.
    test('orphans: 2, diverging from check.py\'s 0 by ADR-0019\'s accepted drift', async () => {
      assert.deepEqual(await orphans(client), [
        'orphan: collibra/bhp-unstructured-declined.md is linked from nowhere',
        'orphan: collibra/collibra-meeting-defaults.md is linked from nowhere',
      ]);
    });

    // No fixture-independent pile-up exists in the frozen vault today: the
    // closest is two facts sharing 2026-11-30, short of the >3 threshold.
    test('review pile-up: none, the frozen vault has no date shared by more than 3 facts', async () => {
      assert.deepEqual(await reviewPileUp(client), []);
    });

    // The whole report in one assertion, so KPA-13's permitted delta is
    // pinned in one place rather than inferred from four. `check.py --review`
    // prints the same seven lines less the two orphans, which is exactly the
    // drift docs/adr/0019-a-root-page-is-not-a-node.md accepts. An eighth
    // line here, or a seventh there, is a defect in the migration.
    test('the whole advisory report: check.py\'s five lines plus ADR-0019\'s two orphans', async () => {
      assert.deepEqual(await advisories(client), [
        'orphan: collibra/bhp-unstructured-declined.md is linked from nowhere',
        'orphan: collibra/collibra-meeting-defaults.md is linked from nowhere',
        'crosses spaces: collibra/collibra-customers.md links koinon/koinon-clients. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: collibra/collibra-people.md links koinon/koinon-people. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: koinon/koinon-clients.md links collibra/collibra-customers. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'crosses spaces: koinon/koinon-people.md links collibra/collibra-people. ' +
          'Fine if it names the boundary, wrong if it carries a fact across.',
        'uncompiled sources: 31 of 32 are cited by no fact. ' +
          'Most bulk imports never should be; a recent one that is not, is worth a look.',
      ]);
    });
  },
);
