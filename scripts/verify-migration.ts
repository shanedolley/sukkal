/**
 * Loads the vault into an empty database and decides whether it agrees.
 *
 * `scripts/verify-migration.sh` runs this after it has run `check.py` and the
 * independent counter, and after it has made the database fresh. It exits 1
 * on any difference no recorded decision explains, and on any count the two
 * counters disagree about. `docs/runbooks/migration-verification.md` says how
 * to read what it prints.
 *
 *   node scripts/verify-migration.ts --today YYYY-MM-DD \
 *     --check-report <check.py output> --counts <count-vault.py output>
 *
 * It reads `VERIFY_DATABASE_URL`, and it refuses production: verifying the
 * migration into `kpa` is a step for a person, on the day amaterasu is
 * reachable, and not one this script takes on its own.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { renderReport } from '../src/checks/report.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { loadVault } from '../src/migrate/load.ts';
import { readVault } from '../src/migrate/read-vault.ts';
import { type Counts, differences, explain, type MigratedFact, normalise, reconcile } from '../src/migrate/verify.ts';
import { vaultPath } from '../src/vault-mapping.ts';

const { values } = parseArgs({
  options: {
    today: { type: 'string' },
    'check-report': { type: 'string' },
    counts: { type: 'string' },
  },
});

const today = values.today;
const checkReport = values['check-report'];
const countsFile = values.counts;
if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !checkReport || !countsFile) {
  console.error('usage: verify-migration.ts --today YYYY-MM-DD --check-report <file> --counts <file>');
  process.exit(2);
}

const client = connect('VERIFY_DATABASE_URL');
await client.connect();
let failed = false;

try {
  await refuseProduction(client);

  const vault = vaultPath();
  const report = await readVault(vault);
  for (const file of report.failures) {
    console.log(`not migrated: ${file.file}: ${file.failures.map((f) => f.reason).join('; ')}`);
  }

  const loaded = await loadVault(client, report, await readFile(path.join(vault, 'index.md'), 'utf8'));
  console.log(`loaded ${JSON.stringify(loaded)}`);

  const sukkalReport = await renderReport(client, today, vault);
  await writeFile(path.join(path.dirname(checkReport), 'sukkal.txt'), sukkalReport);

  const rows = await client.query<{ path: string; verified: string | null; stale_after: string | null }>(
    'SELECT path, verified, stale_after FROM facts',
  );
  const facts = new Map<string, MigratedFact>(
    rows.rows.map((row) => [row.path, { verified: row.verified, staleAfter: row.stale_after }]),
  );

  console.log('\nthe reports');
  const found = differences(normalise(await readFile(checkReport, 'utf8')), normalise(sukkalReport));
  if (found.length === 0) {
    console.log('  identical');
  }
  for (const difference of found) {
    const reason = explain(difference, facts, today);
    const where = difference.side === 'vault' ? 'only check.py' : 'only Sukkal  ';
    console.log(`  ${reason === null ? 'UNEXPLAINED' : 'explained  '}  ${where}  ${difference.line}`);
    if (reason !== null) {
      console.log(`               ${reason}`);
    }
    failed ||= reason === null;
  }

  const held = await client.query<{ [K in keyof Counts]: string }>(
    `SELECT (SELECT count(*) FROM facts) AS facts,
            (SELECT count(*) FROM sources) AS sources,
            (SELECT count(*) FROM tasks) AS tasks,
            (SELECT count(*) FROM needs_you WHERE kind = 'question') AS questions,
            (SELECT count(*) FROM edges) AS edges`,
  );
  const postgres = Object.fromEntries(
    Object.entries(held.rows[0]!).map(([key, value]) => [key, Number(value)]),
  ) as unknown as Counts;
  const counter = JSON.parse(await readFile(countsFile, 'utf8')) as Counts;

  console.log('\nthe counts');
  const mismatches = reconcile(counter, postgres);
  for (const key of Object.keys(counter) as (keyof Counts)[]) {
    const agree = counter[key] === postgres[key];
    console.log(`  ${agree ? 'agree   ' : 'DISAGREE'}  ${key.padEnd(9)} vault ${counter[key]}, Postgres ${postgres[key]}`);
  }
  failed ||= mismatches.length > 0;
} finally {
  await client.end();
}

console.log(failed ? '\nthe migration does not agree with the vault' : '\nthe migration agrees with the vault');
process.exit(failed ? 1 : 0);
