import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { hash } from '../src/auth/password.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, readMigrations, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ACCOUNT = '017_account.sql';
const url = process.env['DATABASE_URL_TEST'];

/** Every column, constraint, index and comment on `users`, as sorted text.
 *  Down then up has to return this unchanged, which is the claim the story
 *  makes and the only one a schema snapshot can settle. */
const SHAPE = `
  SELECT 'column: ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || coalesce(' -- ' || col_description(a.attrelid, a.attnum), '') AS line
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
   UNION ALL
  SELECT 'constraint: ' || conname || ' ' || pg_get_constraintdef(oid)
         || coalesce(' -- ' || obj_description(oid, 'pg_constraint'), '')
    FROM pg_constraint WHERE conrelid = 'users'::regclass
   UNION ALL
  SELECT 'index: ' || indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'users'
   UNION ALL
  SELECT 'comment: ' || coalesce(obj_description('users'::regclass), '(none)')
   ORDER BY 1
`;

describe('the account row', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  /** Runs `body` and undoes everything it wrote, a raised exception included.
   *  Several tests here have to break a constraint to prove it binds, and the
   *  seeded row has to survive all of them. */
  async function rolledBack(body: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await body();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** The one row, whatever the test before it tried to do to the table. */
  async function theOwner(): Promise<Record<string, unknown>> {
    const rows = await client.query<Record<string, unknown>>('SELECT * FROM users');
    assert.equal(rows.rows.length, 1);
    return rows.rows[0]!;
  }

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

  test('users gains an email, an assistant name, a hash and a created date', async () => {
    const columns = await client.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
         AND column_name IN ('email', 'assistant_name', 'password_hash', 'created_at')
       ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { column_name: 'assistant_name', data_type: 'text' },
      { column_name: 'created_at', data_type: 'timestamp with time zone' },
      { column_name: 'email', data_type: 'text' },
      { column_name: 'password_hash', data_type: 'text' },
    ]);
  });

  test('the seeded row survives, holding no account at all', async () => {
    const owner = await theOwner();
    assert.equal(owner['id'], '1');
    assert.equal(owner['name'], 'shane');
    for (const column of ['email', 'assistant_name', 'password_hash', 'created_at']) {
      assert.equal(owner[column], null, column);
    }
  });

  test('an account is written whole', async () => {
    await rolledBack(async () => {
      await client.query(
        `UPDATE users SET email = $1, assistant_name = $2, password_hash = $3,
                          created_at = now() WHERE id = 1`,
        ['shane@koinon.com.au', 'Kothar', await hash('Ärger-ist!7schlimm')],
      );
      const owner = await theOwner();
      assert.equal(owner['email'], 'shane@koinon.com.au');
      assert.match(String(owner['password_hash']), /^\$scrypt\$/);
    });
  });

  test('an account is never written in half', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () => client.query('UPDATE users SET email = $1 WHERE id = 1', ['shane@koinon.com.au']),
        /users_the_account_is_whole/,
      );
    });
  });

  test('an empty address is refused, because null admits one', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `UPDATE users SET email = '  ', assistant_name = 'Kothar',
                              password_hash = '$scrypt$ln=17,r=8,p=1$c2FsdA$a2V5',
                              created_at = now() WHERE id = 1`,
          ),
        /users_every_field_says_something/,
      );
    });
  });

  test('nothing stores a password, only its hash', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () =>
          client.query(
            `UPDATE users SET email = 'shane@koinon.com.au', assistant_name = 'Kothar',
                              password_hash = $1, created_at = now() WHERE id = 1`,
            ['Ärger-ist!7schlimm'],
          ),
        /users_password_is_hashed/,
      );
    });
  });

  test('the table keeps to one row', async () => {
    await rolledBack(async () => {
      await assert.rejects(
        () => client.query("INSERT INTO users (id, name) VALUES (2, 'somebody')"),
        /users_one_owner_per_installation/,
      );
    });
    await theOwner();
  });

  test('the one-row constraint names the ADR-0009 hedge', async () => {
    const comment = await client.query<{ text: string | null }>(`
      SELECT obj_description(oid, 'pg_constraint') AS text FROM pg_constraint
       WHERE conrelid = 'users'::regclass AND conname = 'users_one_owner_per_installation'
    `);
    assert.match(String(comment.rows[0]?.text), /one owner per installation/);
  });

  test('two addresses differing only in case are one account', async () => {
    // The one-row constraint hides the unique index, because one row can hold
    // one address. Dropping it inside a transaction is the only way to ask
    // whether the index binds, and it is the state this installation reaches
    // the day somebody adds a second owner.
    await rolledBack(async () => {
      await client.query('ALTER TABLE users DROP CONSTRAINT users_one_owner_per_installation');
      await client.query(
        `UPDATE users SET email = 'shane@koinon.com.au', assistant_name = 'Kothar',
                          password_hash = '$scrypt$ln=17,r=8,p=1$c2FsdA$a2V5',
                          created_at = now() WHERE id = 1`,
      );
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO users (id, name, email, assistant_name, password_hash, created_at)
             VALUES (2, 'somebody', 'Shane@Koinon.Com.Au', 'Kothar',
                     '$scrypt$ln=17,r=8,p=1$c2FsdA$a2V5', now())`,
          ),
        /users_email_is_one_account/,
      );
    });
  });

  test('the migration refuses a users row it did not create', async () => {
    const account = (await readMigrations(MIGRATIONS)).find((one) => one.name === ACCOUNT);
    assert.ok(account, `no ${ACCOUNT} in ${MIGRATIONS}`);

    // The exact situation the criterion describes, built and then undone: a
    // users row carrying no email that 001_core_schema.sql did not seed. The
    // migration has to stop rather than leave it with a null one.
    await rolledBack(async () => {
      await client.query(account.down);
      await client.query("INSERT INTO users (id, name) VALUES (2, 'somebody')");
      await assert.rejects(() => client.query(account.up), /did not seed/);
    });
    await theOwner();
  });

  test('down then up returns the schema to what it was', async () => {
    const before = await client.query<{ line: string }>(SHAPE);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    const after = await client.query<{ line: string }>(SHAPE);
    assert.deepEqual(after.rows, before.rows);
    assert.ok(before.rows.length > 0);
  });
});
