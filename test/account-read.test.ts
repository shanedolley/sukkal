import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** Every column, constraint, index and comment on `users`, as sorted text.
 *  Down then up has to return this unchanged, which is the only claim a schema
 *  snapshot can settle. Taken from `test/account.test.ts`, which makes the same
 *  claim about migration 017. */
const SHAPE = `
  SELECT 'column: ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
         || coalesce(' -- ' || col_description(a.attrelid, a.attnum), '') AS line
    FROM pg_attribute a
   WHERE a.attrelid = 'users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
   UNION ALL
  SELECT 'constraint: ' || conname || ' ' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE conrelid = 'users'::regclass
   ORDER BY 1
`;

const SELECTION = {
  accentId: 'violet',
  chartsId: 'ocean',
  accentHex: '#5b21b6',
  chartsHex: '#0d6b45',
};

describe(
  'the colours the owner picked',
  { skip: url ? false : 'DATABASE_URL_TEST is unset' },
  () => {
    let client: ClientBase & { end: () => Promise<void> };

    /** Runs `body` and undoes everything it wrote, a raised exception included.
     *  Two tests here break a constraint to prove it binds, and the seeded row
     *  has to survive both. */
    async function rolledBack(body: () => Promise<void>): Promise<void> {
      await client.query('BEGIN');
      try {
        await body();
      } finally {
        await client.query('ROLLBACK');
      }
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

    test('users gains one jsonb column, and it is nullable', async () => {
      const columns = await client.query<{
        data_type: string;
        is_nullable: string;
      }>(`
        SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name = 'appearance'
      `);
      assert.deepEqual(columns.rows, [{ data_type: 'jsonb', is_nullable: 'YES' }]);
    });

    test('nobody has chosen, so the column is null', async () => {
      const rows = await client.query<{ appearance: unknown }>(
        'SELECT appearance FROM users WHERE id = 1',
      );
      assert.equal(rows.rows[0]?.appearance, null);
    });

    test('a selection goes in and comes back whole', async () => {
      await rolledBack(async () => {
        await client.query('UPDATE users SET appearance = $1 WHERE id = 1', [SELECTION]);
        const rows = await client.query<{ appearance: unknown }>(
          'SELECT appearance FROM users WHERE id = 1',
        );
        assert.deepEqual(rows.rows[0]?.appearance, SELECTION);
      });
    });

    test('the column refuses what could carry no fields', async () => {
      for (const wrong of ['[]', '3', '"green"', 'null']) {
        await rolledBack(async () => {
          await assert.rejects(
            () =>
              client.query(`UPDATE users SET appearance = $1::jsonb WHERE id = 1`, [wrong]),
            /users_appearance_is_an_object/,
            `${wrong} was stored`,
          );
        });
      }
    });

    test('a colour is chosen before an account exists', async () => {
      // The proof that this column joins no whole-account constraint. The four
      // account columns are null here, and the write still lands, so somebody
      // may pick a colour on a box nobody has set up.
      await rolledBack(async () => {
        await client.query('UPDATE users SET appearance = $1 WHERE id = 1', [SELECTION]);
        const rows = await client.query<{ email: string | null; appearance: unknown }>(
          'SELECT email, appearance FROM users WHERE id = 1',
        );
        assert.equal(rows.rows[0]?.email, null);
        assert.deepEqual(rows.rows[0]?.appearance, SELECTION);
      });
    });

    test('the account is still written whole, and the colour is not part of it', async () => {
      // `users_the_account_is_whole` counts four columns and `appearance` is
      // not one of them, so an account written without a colour is whole.
      await rolledBack(async () => {
        await client.query(
          `UPDATE users
              SET name = 'Shane Dolley', email = $1, assistant_name = 'Kestrel',
                  password_hash = $2, created_at = now()
            WHERE id = 1`,
          ['shane@koinon.com.au', '$scrypt$ln=17,r=8,p=1$abcdefgh$ijklmnop'],
        );
        const rows = await client.query<{ appearance: unknown }>(
          'SELECT appearance FROM users WHERE id = 1',
        );
        assert.equal(rows.rows[0]?.appearance, null);
      });
    });

    test('down then up returns the schema to what it was', async () => {
      const before = await client.query<{ line: string }>(SHAPE);
      await down(client, MIGRATIONS);
      await up(client, MIGRATIONS);
      const after = await client.query<{ line: string }>(SHAPE);
      assert.deepEqual(after.rows, before.rows);
      assert.ok(before.rows.some((row) => row.line.startsWith('column: appearance')));
    });
  },
);
