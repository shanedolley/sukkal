import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';

import { daysBetween, formatReport } from '../src/checks/report.ts';
import { ADR_0019_ORPHANS, differences, explain, type MigratedFact, normalise, reconcile } from '../src/migrate/verify.ts';

const CROSS =
  'crosses spaces: koinon/a.md links collibra/b. Fine if it names the boundary, wrong if it carries a fact across.';

// The layout check.py's main() prints, copied from a real run against the
// frozen vault on 13 September 2026 and cut down to one line of each kind.
const CHECK_PY = `shared/x.md: missing \`title:\`
19 notes, 1 problems

1 past their review date:
  koinon/marinucci-data-warehouse-proposal.md  due 2026-09-12, 1 day ago
Re-confirm each against current evidence, or retire it.

1 worth a look:
  ${CROSS}
`;

describe('the report layout', () => {
  test('formatReport prints exactly what check.py prints', () => {
    assert.equal(
      formatReport({
        problems: ['shared/x.md: missing `title:`'],
        notes: 19,
        due: [{ path: 'koinon/marinucci-data-warehouse-proposal.md', due: '2026-09-12', days: 1 }],
        advisories: [CROSS],
      }),
      CHECK_PY,
    );
  });

  test('"1 day ago" is singular and every other count is plural, as check.py writes it', () => {
    const due = (days: number) =>
      formatReport({ problems: [], notes: 1, due: [{ path: 'a/b.md', due: '2026-09-01', days }], advisories: [] });
    assert.match(due(1), /, 1 day ago\n/);
    assert.match(due(2), /, 2 days ago\n/);
    assert.match(due(0), /, 0 days ago\n/);
  });

  test('an empty review list and an empty advisory list print no heading at all', () => {
    assert.equal(formatReport({ problems: [], notes: 3, due: [], advisories: [] }), '3 notes, 0 problems\n');
  });

  test('days are whole calendar days, and Sydney moving its clocks changes nothing', () => {
    assert.equal(daysBetween('2026-09-12', '2026-09-13'), 1);
    // Daylight saving starts in Sydney on 4 October 2026.
    assert.equal(daysBetween('2026-10-03', '2026-10-05'), 2);
    assert.equal(daysBetween('2026-09-13', '2026-09-13'), 0);
  });
});

describe('normalising a report', () => {
  test('tags every line by section and drops the headings, whose counts the lists already carry', () => {
    assert.deepEqual(normalise(CHECK_PY), [
      'problem: shared/x.md: missing `title:`',
      'notes: 19',
      'stale: koinon/marinucci-data-warehouse-proposal.md  due 2026-09-12, 1 day ago',
      `advisory: ${CROSS}`,
    ]);
  });

  test('a report with no review list still files its advisories as advisories', () => {
    assert.deepEqual(normalise(`2 notes, 0 problems\n\n1 worth a look:\n  ${CROSS}\n`), [
      'notes: 2',
      `advisory: ${CROSS}`,
    ]);
  });
});

describe('finding the differences', () => {
  test('a line on both sides is no difference, and a repeat counts', () => {
    assert.deepEqual(differences(['a', 'b', 'b'], ['b', 'a']), [{ side: 'vault', line: 'b' }]);
    assert.deepEqual(differences(['a'], ['a', 'c', 'c']), [
      { side: 'sukkal', line: 'c' },
      { side: 'sukkal', line: 'c' },
    ]);
    assert.deepEqual(differences(['x'], ['x']), []);
  });
});

describe('explaining a difference', () => {
  const today = '2026-09-13';
  const facts = new Map<string, MigratedFact>([
    ['koinon/due-today.md', { verified: '2026-08-01', staleAfter: today }],
    ['koinon/unverified.md', { verified: null, staleAfter: '2026-09-01' }],
    ['koinon/really-stale.md', { verified: '2026-08-01', staleAfter: '2026-09-01' }],
  ]);
  const staleLine = (file: string, due: string, days: number) =>
    `stale: ${file}  due ${due}, ${days} day${days === 1 ? '' : 's'} ago`;

  test('ADR-0019 passes its two named orphans, and only on Sukkal\'s side', () => {
    for (const line of ADR_0019_ORPHANS) {
      assert.match(explain({ side: 'sukkal', line }, facts, today) ?? '', /^ADR-0019/);
      assert.equal(explain({ side: 'vault', line }, facts, today), null, 'check.py never prints these');
    }
  });

  test('a third orphan is a defect, however much it looks like the two', () => {
    const third = 'advisory: orphan: collibra/something-else.md is linked from nowhere';
    assert.equal(explain({ side: 'sukkal', line: third }, facts, today), null);
  });

  test('ADR-0010 passes a review line check.py prints for a fact due today', () => {
    const line = staleLine('koinon/due-today.md', today, 0);
    assert.match(explain({ side: 'vault', line }, facts, today) ?? '', /due today/);
  });

  test('ADR-0010 passes a review line check.py prints for an unverified fact', () => {
    const line = staleLine('koinon/unverified.md', '2026-09-01', 12);
    assert.match(explain({ side: 'vault', line }, facts, today) ?? '', /unverified/);
  });

  test('a verified fact past its date that Sukkal leaves out is a defect, not ADR-0010', () => {
    const line = staleLine('koinon/really-stale.md', '2026-09-01', 12);
    assert.equal(explain({ side: 'vault', line }, facts, today), null);
  });

  test('the explanation is proved on the row, so a line naming another date passes nothing', () => {
    // check.py says the fact falls due today; the migrated row says otherwise.
    const line = staleLine('koinon/really-stale.md', today, 0);
    assert.equal(explain({ side: 'vault', line }, facts, today), null);
  });

  test('a review line for a fact that never migrated is a defect', () => {
    const line = staleLine('koinon/missing.md', today, 0);
    assert.equal(explain({ side: 'vault', line }, facts, today), null);
  });

  test('anything else, on either side, is a defect', () => {
    assert.equal(explain({ side: 'sukkal', line: 'notes: 18' }, facts, today), null);
    assert.equal(explain({ side: 'vault', line: `advisory: ${CROSS}` }, facts, today), null);
  });
});

describe('reconciling the counts', () => {
  const counts = { facts: 19, sources: 32, tasks: 3, questions: 2, edges: 84 };

  test('two equal counts reconcile', () => {
    assert.deepEqual(reconcile(counts, { ...counts }), []);
  });

  test('each disagreement is named with both numbers', () => {
    assert.deepEqual(reconcile(counts, { ...counts, edges: 83, tasks: 0 }), [
      'tasks: the vault holds 3, Postgres holds 0',
      'edges: the vault holds 84, Postgres holds 83',
    ]);
  });
});

const python = spawnSync('python3', ['--version']).status === 0;

describe('the independent counter', { skip: python ? false : 'python3 is not on PATH' }, () => {
  test('its own fixtures pass, which is what REQ-033 asks of it', () => {
    const run = spawnSync('python3', [path.join(import.meta.dirname, '..', 'scripts', 'count-vault.py'), '--selftest'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'selftest ok');
  });
});
