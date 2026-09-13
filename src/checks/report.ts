/**
 * The whole report, in the words and the layout `check.py` prints.
 *
 * KPA-13 diffs this against a run of the vault's own checker, so the layout is
 * copied from `check.py`'s `main()` line for line: the problems, a count line,
 * the facts past their review date, and the advisories. A rewording on either
 * side is meant to show up as a diff rather than hide inside one.
 *
 * Each part comes from the rule that already owns it. `problems` reads the
 * vault, as KPA-11 ported it. The count, the review list and the advisories
 * read Postgres. The review list is `stale` from `retire.ts`, so ADR-0010's two
 * conditions reach this report unchanged: a fact due today is not yet stale,
 * and an unverified fact never is. `check.py` holds neither condition, and
 * `src/migrate/verify.ts` names each line that difference costs.
 */
import type { ClientBase } from 'pg';

import type { Day } from '../memory/retire.ts';
import { stale } from '../memory/retire.ts';
import { vaultPath } from '../vault-mapping.ts';
import { advisories } from './advisories.ts';
import { problems } from './problems.ts';

export interface DueFact {
  path: string;
  due: Day;
  days: number;
}

export interface ReportParts {
  problems: string[];
  notes: number;
  due: DueFact[];
  advisories: string[];
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`, counted in UTC so no
 *  timezone moves a date across midnight. */
export function daysBetween(from: Day, to: Day): number {
  const utc = (day: Day) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** `check.py`'s `main()`, as text. */
export function formatReport(parts: ReportParts): string {
  const lines = [...parts.problems, `${parts.notes} notes, ${parts.problems.length} problems`];

  if (parts.due.length > 0) {
    lines.push('', `${parts.due.length} past their review date:`);
    for (const fact of parts.due) {
      lines.push(`  ${fact.path}  due ${fact.due}, ${fact.days} day${fact.days === 1 ? '' : 's'} ago`);
    }
    lines.push('Re-confirm each against current evidence, or retire it.');
  }

  if (parts.advisories.length > 0) {
    lines.push('', `${parts.advisories.length} worth a look:`);
    for (const line of parts.advisories) {
      lines.push(`  ${line}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** Gathers the four parts from the vault and from Postgres, then formats them. */
export async function renderReport(client: ClientBase, today: Day, vault: string = vaultPath()): Promise<string> {
  const paths = await stale(client, today);
  const dates = await client.query<{ path: string; stale_after: Day }>(
    'SELECT path, stale_after FROM facts WHERE path = ANY($1)',
    [paths],
  );
  const dueOn = new Map(dates.rows.map((row) => [row.path, row.stale_after]));
  const notes = await client.query<{ n: string }>('SELECT count(*) AS n FROM facts');

  return formatReport({
    problems: await problems(vault),
    notes: Number(notes.rows[0]!.n),
    due: paths.map((path) => {
      const due = dueOn.get(path)!;
      return { path, due, days: daysBetween(due, today) };
    }),
    advisories: await advisories(client),
  });
}
