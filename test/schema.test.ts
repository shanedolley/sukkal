import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { EMBEDDING } from '../src/embedding.ts';
import {
  ENUMS,
  FRONTMATTER,
  SPACES,
  frontmatterKeys,
  frontmatterValue,
  vaultPath,
} from '../src/vault-mapping.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** Every note in a space, as a path and its text. */
function spaceNotes(): { file: string; text: string }[] {
  const root = vaultPath();
  const notes: { file: string; text: string }[] = [];
  for (const space of SPACES) {
    const dir = path.join(root, space);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const file = path.join(entry.parentPath, entry.name);
        notes.push({ file: path.relative(root, file), text: readFileSync(file, 'utf8') });
      }
    }
  }
  return notes;
}

const vaultReason = existsSync(vaultPath())
  ? false
  : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('the core schema', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  test('creates every table the story names', async () => {
    const tables = await client.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
       ORDER BY c.relname
    `);
    // questions is absent on purpose. ADR-0012 folded it into needs_you, so a
    // question is one of that queue's four kinds rather than a table of its own.
    assert.deepEqual(tables.rows.map((row) => row.relname), [
      'answers', 'audit', 'citations', 'connection_credentials', 'connections',
      'conversations', 'edges', 'entities', 'facts', 'inbound_deliveries',
      'issue_blocks', 'issues', 'meetings', 'needs_you', 'nodes',
      'password_resets', 'policies', 'projects', 'rejections', 'sessions',
      'source_chunks', 'sources', 'tasks', 'users', 'workspace_fields',
      'workspaces',
    ]);
  });

  test('seeds exactly one user, and every owner_id defaults to it', async () => {
    const users = await client.query<{ id: string }>('SELECT id FROM users');
    assert.equal(users.rows.length, 1);

    const defaults = await client.query<{ table_name: string; column_default: string }>(`
      SELECT table_name, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'owner_id' ORDER BY table_name
    `);
    assert.deepEqual(defaults.rows.map((row) => row.table_name), [
      'facts', 'meetings', 'password_resets', 'sessions', 'sources', 'tasks',
    ]);

    // Four tables default the column, which is ADR-0009's hedge: a fact, a
    // meeting, a source and a task belong to the one owner, and the default
    // saves every writer naming them.
    //
    // The two authentication tables do not, and the difference is deliberate.
    // A session and a reset token are each made for one person by one act, so
    // `issue` in `src/auth/session.ts` and `issueFor` in `src/auth/reset.ts`
    // always name whose they are. A default there would let a bug write
    // somebody else's row as the owner's, which is where that matters most.
    const named = new Set(['sessions', 'password_resets']);
    for (const row of defaults.rows) {
      const expected = named.has(row.table_name) ? null : '1';
      assert.equal(row.column_default, expected, row.table_name);
    }
  });

  test('declares both vector columns at the width src/embedding.ts pins', async () => {
    const columns = await client.query<{ relname: string; width: string }>(`
      SELECT c.relname, format_type(a.atttypid, a.atttypmod) AS width
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'embedding'
       ORDER BY c.relname
    `);
    assert.deepEqual(columns.rows.map((row) => row.relname), ['facts', 'source_chunks']);
    for (const row of columns.rows) {
      assert.equal(row.width, `vector(${EMBEDDING.dimension})`, row.relname);
    }
  });

  test('indexes both vector columns with HNSW', async () => {
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexdef LIKE '%USING hnsw%' ORDER BY indexname
    `);
    assert.deepEqual(indexes.rows.map((row) => row.indexname), [
      'facts_embedding', 'source_chunks_embedding',
    ]);
  });

  describe('the nodes registry', () => {
    /** A fresh node of `kind`, returning its id. */
    async function node(kind: string, ref: string | null = null): Promise<string> {
      const created = await client.query<{ id: string }>(
        'INSERT INTO nodes (kind, ref) VALUES ($1, $2) RETURNING id',
        [kind, ref],
      );
      return created.rows[0]!.id;
    }

    const FACT = `INSERT INTO facts (id, path, type, title, description, space, state)
                  VALUES ($1, $2, 'system', 't', 'd', 'shared', 'proposed')`;

    test('rejects a node whose kind disagrees with the table claiming it', async () => {
      await client.query('BEGIN');
      const id = await node('url', 'https://example.com');
      await assert.rejects(
        client.query(FACT, [id, 'wrong-kind.md']),
        /violates foreign key constraint/,
      );
      await client.query('ROLLBACK');
    });

    test('rejects an id claimed by two child tables', async () => {
      await client.query('BEGIN');
      const id = await node('fact');
      await client.query(FACT, [id, 'claimed.md']);
      await assert.rejects(
        client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
          id, 'claimed-source.md', 'raw',
        ]),
        /violates foreign key constraint/,
      );
      await client.query('ROLLBACK');
    });

    test('rejects a node of kind fact with no facts row, at commit', async () => {
      await client.query('BEGIN');
      await node('fact');
      await assert.rejects(client.query('COMMIT'), /has kind fact and no fact row/);
    });

    test('requires a ref on the two kinds that have no child table', async () => {
      await client.query('BEGIN');
      await assert.rejects(node('unresolved'), /nodes_ref_suits_kind/);
      await client.query('ROLLBACK');
    });

    test('accepts a fact, a source, and a typed edge between them', async () => {
      await client.query('BEGIN');
      const factId = await node('fact');
      await client.query(FACT, [factId, 'happy.md']);
      const sourceId = await node('source');
      await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [
        sourceId, 'happy-source.md', 'raw',
      ]);
      await client.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3)', [
        factId, sourceId, 'derived_from',
      ]);
      await client.query('COMMIT');

      const walk = await client.query<{ kind: string; to_kind: string }>(`
        SELECT e.kind, n.kind AS to_kind FROM edges e JOIN nodes n ON n.id = e.to_id
      `);
      assert.deepEqual(walk.rows, [{ kind: 'derived_from', to_kind: 'source' }]);
      await client.query('DELETE FROM edges');
    });
  });

  test('refuses to let a machine mark its own work verified', async () => {
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    await assert.rejects(
      client.query(
        `INSERT INTO facts (id, path, type, title, description, space, state,
                            verified, verified_by)
         VALUES ($1, 'agent.md', 'system', 't', 'd', 'shared', 'proposed',
                 '2026-08-27', 'agent:claude-opus-5')`,
        [created.rows[0]!.id],
      ),
      /facts_machine_never_verifies/,
    );
    await client.query('ROLLBACK');
  });

  test('retires a fact by date, and the row stays queryable', async () => {
    await client.query('BEGIN');
    const created = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = created.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, 'retire.md', 'system', 't', 'd', 'shared', 'proposed', '2026-01-01')`,
      [id],
    );
    await client.query('UPDATE facts SET valid_to = $2 WHERE id = $1', [id, '2026-06-01']);

    const asAtMarch = await client.query(
      `SELECT 1 FROM facts WHERE id = $1
        AND valid_from <= '2026-03-01' AND (valid_to IS NULL OR valid_to > '2026-03-01')`,
      [id],
    );
    assert.equal(asAtMarch.rows.length, 1, 'the fact was true in March');

    const asAtToday = await client.query(
      `SELECT 1 FROM facts WHERE id = $1
        AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to > CURRENT_DATE)`,
      [id],
    );
    assert.equal(asAtToday.rows.length, 0, 'and is retired now');
    await client.query('ROLLBACK');
  });

  describe('against the real vault', { skip: vaultReason }, () => {
    test('every frontmatter key in a space maps to a column or an edge', () => {
      const unmapped: string[] = [];
      for (const { file, text } of spaceNotes()) {
        for (const key of frontmatterKeys(text)) {
          if (!(key in FRONTMATTER)) {
            unmapped.push(`${file}: ${key}`);
          }
        }
      }
      assert.deepEqual(
        unmapped,
        [],
        `unmapped frontmatter keys. Add each to src/vault-mapping.ts and give it a column:\n${unmapped.join('\n')}`,
      );
    });

    test('every enum value in the vault is one the schema accepts', async () => {
      const notes = spaceNotes();
      assert.ok(notes.length > 0, 'the vault holds no notes in any space');

      for (const [key, type] of Object.entries(ENUMS)) {
        const labels = await client.query<{ label: string }>(
          'SELECT enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1',
          [type],
        );
        const accepted = new Set(labels.rows.map((row) => row.label));
        assert.ok(accepted.size > 0, `no such enum: ${type}`);

        for (const { file, text } of notes) {
          const value = frontmatterValue(text, key);
          if (value !== undefined && value !== '') {
            assert.ok(
              accepted.has(value),
              `${file}: ${key} is "${value}", which ${type} does not list`,
            );
          }
        }
      }
    });
  });
});
