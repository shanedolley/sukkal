/**
 * The migration runner.
 *
 * Every file in `migrations/` carries both directions. A line reading
 * `-- @down` separates them: the SQL above it applies the migration, the SQL
 * below it reverses the same migration. Files run in filename order, so name
 * them with a numeric prefix.
 *
 * The table `schema_migrations` records what ran. The runner refuses a
 * database that already holds objects it did not create, and refuses an `up`
 * that has nothing left to apply. It does not try to be idempotent: a second
 * run reports what it found and stops.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClientBase } from 'pg';
import { PRODUCTION, connect } from './connect.ts';

/** Separates the two directions inside one migration file. */
const DOWN_MARKER = /^--[ \t]*@down[ \t]*$/m;

/** Relations in `public`. Extensions such as pgvector create none, so an
 *  installed extension does not make a database look populated. */
const PUBLIC_RELATIONS = `
  SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
   ORDER BY c.relname
`;

export interface Migration {
  name: string;
  up: string;
  down: string;
}

/** Reads every `.sql` file in `dir`, in filename order. */
export async function readMigrations(dir: string): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(path.join(dir, name), 'utf8');
      const halves = text.split(DOWN_MARKER);
      if (halves.length !== 2) {
        throw new Error(
          `${name}: expected one "-- @down" line, found ${halves.length - 1}`,
        );
      }
      return { name, up: halves[0]!.trim(), down: halves[1]!.trim() };
    }),
  );
}

async function exists(client: ClientBase, table: string): Promise<boolean> {
  const result = await client.query<{ oid: string | null }>(
    'SELECT to_regclass($1) AS oid',
    [`public.${table}`],
  );
  return result.rows[0]?.oid != null;
}

/** Returns the migrations already recorded, creating the ledger on first use.
 *  Throws when the database holds relations this runner did not create. */
async function ledger(client: ClientBase): Promise<string[]> {
  if (!(await exists(client, 'schema_migrations'))) {
    const found = (await client.query<{ relname: string }>(PUBLIC_RELATIONS)).rows;
    if (found.length > 0) {
      throw new Error(
        `refusing to migrate: schema "public" already holds ${found.length} ` +
          `relation(s) this runner did not create: ` +
          found.map((row) => row.relname).join(', '),
      );
    }
    await client.query(`
      CREATE TABLE schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  const applied = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name',
  );
  return applied.rows.map((row) => row.name);
}

async function inTransaction(
  client: ClientBase,
  name: string,
  work: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${name}: ${reason}`, { cause });
  }
}

/** Applies every migration not yet recorded. Returns the names it applied. */
export async function up(client: ClientBase, dir: string): Promise<string[]> {
  const files = await readMigrations(dir);
  if (files.length === 0) {
    return [];  // Touch nothing, so an empty migrations directory writes no ledger.
  }

  const applied = await ledger(client);
  const pending = files.filter((file) => !applied.includes(file.name));

  if (pending.length === 0) {
    if (applied.length > 0) {
      throw new Error(
        `nothing to apply: ${applied.length} migration(s) already recorded: ` +
          applied.join(', '),
      );
    }
    return [];
  }

  for (const migration of pending) {
    await inTransaction(client, migration.name, async () => {
      await client.query(migration.up);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        migration.name,
      ]);
    });
  }
  return pending.map((migration) => migration.name);
}

/** Reverses every recorded migration, newest first, and drops the ledger.
 *  The database is empty afterwards. Returns the names it reversed. */
export async function down(client: ClientBase, dir: string): Promise<string[]> {
  if (!(await exists(client, 'schema_migrations'))) {
    return [];
  }

  const files = new Map(
    (await readMigrations(dir)).map((migration) => [migration.name, migration]),
  );
  const applied = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY name DESC',
  );

  for (const { name } of applied.rows) {
    const migration = files.get(name);
    if (!migration) {
      throw new Error(`cannot reverse ${name}: no file of that name in ${dir}`);
    }
    await inTransaction(client, name, async () => {
      await client.query(migration.down);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
    });
  }

  await client.query('DROP TABLE schema_migrations');
  return applied.rows.map((row) => row.name);
}

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Refuses a database this command was probably not meant to reach.
 *
 * `npm run migrate` reads `DATABASE_URL` and nothing else, so writing
 * `DATABASE_URL_TEST=... npm run migrate` points it AT production rather than
 * away from it. An agent did that on 3 September 2026 and put all 21
 * migrations into `kpa`. Nothing was lost, because `kpa` was empty and the
 * runner refuses a schema holding tables it did not create, and the next one
 * will not be so lucky.
 *
 * `PRODUCTION` in `connect.ts` holds the names this refuses, and the rest of
 * the repository keeps the same rule against the same array: every test calls
 * `refuseProduction`, and CLAUDE.md says never to point one at production. A
 * prefix rule was the first attempt and it was worse, because it also refused
 * a throwaway somebody named for the job rather than for the convention.
 *
 * `SUKKAL_ALLOW_PRODUCTION=1` migrates it deliberately, and records the intent
 * at the moment it is used, the way `KOTHAR_ALLOW_MAIN` does for a commit on
 * the trunk.
 */
function checkTarget(database: string): void {
  if (
    !PRODUCTION.includes(database) ||
    process.env['SUKKAL_ALLOW_PRODUCTION'] === '1'
  ) {
    return;
  }
  throw new Error(
    `refusing to migrate "${database}": it holds the facts.\n` +
      'This command reads DATABASE_URL, so putting DATABASE_URL_TEST in front ' +
      'of it changes nothing.\n' +
      'To migrate it deliberately: SUKKAL_ALLOW_PRODUCTION=1 npm run migrate',
  );
}

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`unknown direction "${direction}": expected "up" or "down"`);
  }

  const client = connect();
  await client.connect();
  const current = await client.query<{ name: string }>('SELECT current_database() AS name');
  const database = current.rows[0]?.name ?? '';
  // Named out loud before anything runs, because the last question anybody
  // asks after a migration is which database it reached.
  console.log(`${direction}: ${database}, read from DATABASE_URL`);
  try {
    checkTarget(database);
  } catch (error) {
    await client.end();
    throw error;
  }
  try {
    const ran = direction === 'up'
      ? await up(client, MIGRATIONS_DIR)
      : await down(client, MIGRATIONS_DIR);
    console.log(ran.length === 0 ? `nothing to ${direction}` : `${direction}: ${ran.join(', ')}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
