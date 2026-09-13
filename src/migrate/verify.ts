/**
 * How KPA-13 decides whether the migration agrees with the vault.
 *
 * Two reports in `check.py`'s layout, one from `check.py` itself and one from
 * `src/checks/report.ts`, become lists of tagged lines. A line on one side and
 * not the other is a difference, and every difference is either explained by a
 * decision already recorded or it fails the run. The migration is wrong until
 * proven otherwise, not the old checker, so an explanation has to be proved
 * against the migrated rows rather than read off the shape of the line.
 *
 * Two decisions explain a difference today, and nothing else does:
 *
 * - **ADR-0019.** A root page is not a node, so a fact linked only from
 *   `index.md` or `log.md` reads as an orphan here and not in `check.py`. The
 *   ADR names the two orphans that costs, and only those two lines pass.
 * - **ADR-0010.** A fact goes stale strictly past `stale_after`, and only once
 *   it is verified. `check.py` lists a fact due today and an unverified fact
 *   past its date. Such a line passes only when the migrated row really is due
 *   today or really is unverified.
 *
 * The header lines carry counts derived from the lists, so they are dropped
 * rather than compared: comparing the lists already compares the counts, and a
 * header left in would report one difference as two.
 */

export type Side = 'vault' | 'sukkal';

export interface Counts {
  facts: number;
  sources: number;
  tasks: number;
  questions: number;
  edges: number;
}

export interface MigratedFact {
  verified: string | null;
  staleAfter: string | null;
}

export interface Difference {
  side: Side;
  line: string;
  /** The recorded decision that accounts for it, or null when nothing does. */
  reason: string | null;
}

/** The two orphans ADR-0019 accepts, by name. A third is a defect. */
export const ADR_0019_ORPHANS = [
  'advisory: orphan: collibra/bhp-unstructured-declined.md is linked from nowhere',
  'advisory: orphan: collibra/collibra-meeting-defaults.md is linked from nowhere',
] as const;

/**
 * One report as tagged lines, in the order it printed them.
 *
 * `problem:` for each line above the count, `notes:` for the count,
 * `stale:` for a fact past its review date, and `advisory:` for each line
 * worth a look.
 */
export function normalise(report: string): string[] {
  const out: string[] = [];
  let section: 'problems' | 'stale' | 'advisories' = 'problems';

  for (const raw of report.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') {
      continue;
    }
    const count = /^(\d+) notes, \d+ problems$/.exec(line);
    if (count) {
      out.push(`notes: ${count[1]}`);
      section = 'stale';
      continue;
    }
    if (/^\d+ past their review date:$/.test(line)) {
      section = 'stale';
      continue;
    }
    if (/^\d+ worth a look:$/.test(line)) {
      section = 'advisories';
      continue;
    }
    if (line === 'Re-confirm each against current evidence, or retire it.') {
      continue;
    }

    if (section === 'problems') {
      out.push(`problem: ${line}`);
    } else if (section === 'stale') {
      out.push(`stale: ${line.trim()}`);
    } else {
      out.push(`advisory: ${line.trim()}`);
    }
  }

  return out;
}

/** The lines each side printed that the other did not, counting repeats. */
export function differences(vault: readonly string[], sukkal: readonly string[]): { side: Side; line: string }[] {
  const remaining = new Map<string, number>();
  for (const line of sukkal) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  const out: { side: Side; line: string }[] = [];
  for (const line of vault) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
    } else {
      out.push({ side: 'vault', line });
    }
  }
  for (const line of sukkal) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      remaining.set(line, left - 1);
      out.push({ side: 'sukkal', line });
    }
  }
  return out;
}

/** Why one difference is allowed, or null when no recorded decision covers it. */
export function explain(
  difference: { side: Side; line: string },
  facts: ReadonlyMap<string, MigratedFact>,
  today: string,
): string | null {
  if (difference.side === 'sukkal' && (ADR_0019_ORPHANS as readonly string[]).includes(difference.line)) {
    return 'ADR-0019: a root page is not a node, so this fact is linked from nowhere in the memory';
  }

  const stale = /^stale: (\S+) {2}due (\d{4}-\d{2}-\d{2}), \d+ days? ago$/.exec(difference.line);
  if (difference.side === 'vault' && stale) {
    const fact = facts.get(stale[1]!);
    if (fact === undefined || fact.staleAfter !== stale[2]) {
      return null;
    }
    if (fact.staleAfter === today) {
      return 'ADR-0010: a fact falling due today is not yet stale';
    }
    if (fact.verified === null) {
      return 'ADR-0010: an unverified fact has nothing to have gone stale from';
    }
  }

  return null;
}

/** Each count on which the independent counter and Postgres disagree. */
export function reconcile(counter: Counts, postgres: Counts): string[] {
  return (Object.keys(counter) as (keyof Counts)[])
    .filter((key) => counter[key] !== postgres[key])
    .map((key) => `${key}: the vault holds ${counter[key]}, Postgres holds ${postgres[key]}`);
}
