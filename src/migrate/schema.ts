/**
 * The frontmatter schema a note in a space must satisfy, and the vault's own
 * status vocabulary translated onto fact_state.
 *
 * KPA-59 replaced `fact_status` with `fact_state` and left the two
 * vocabularies sharing no value. `src/vault-mapping.ts` therefore dropped
 * `status` from `ENUMS`, which the story's own rule calls out: a validator
 * that stops checking a field checks nothing about it, and every note in the
 * vault carries this one. `validateFrontmatter` checks it against the
 * vault's own vocabulary instead of the target's, then translates a value
 * that passes. ADR-0011 records what each value translates to and why; this
 * file is where that decision is applied, not where it is made.
 */
import { FRONTMATTER, SPACES } from '../vault-mapping.ts';

/** Postgres's `fact_type` labels. Duplicated here because this file has no
 *  database to ask; `docs/schema.md` is the source of truth. */
export const FACT_TYPES = [
  'person',
  'customer',
  'engagement',
  'system',
  'policy',
  'decision',
  'preference',
  'reference',
  'source',
] as const;

/** The vault's own status vocabulary, retired by ADR-0010 but still on every
 *  note in the frozen vault. */
export const VAULT_STATUSES = ['draft', 'stable', 'deprecated'] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

/** `facts.state`'s three stored values. `verified`, `stale` and `retired`
 *  are read from dates, not stored, so no vault status maps to them. */
export type FactState = 'candidate' | 'proposed' | 'rejected';

/**
 * ADR-0011's mapping: `draft` becomes `candidate`, `stable` becomes
 * `proposed`, `deprecated` becomes `rejected`. Every note in the frozen
 * vault reads `stable`, so every one lands in the review queue Shane already
 * checks rather than going back through gates built for raw extraction.
 */
export const STATUS_TO_STATE: Readonly<Record<VaultStatus, FactState>> = {
  draft: 'candidate',
  stable: 'proposed',
  deprecated: 'rejected',
};

/** The frontmatter keys every note in a space carries. Missing from this
 *  list on purpose: `project`, `verified`, `verified_by` and `stale_after`,
 *  none of which every note in the frozen vault carries. */
export const REQUIRED_FIELDS = [
  'type',
  'title',
  'description',
  'space',
  'tags',
  'status',
  'generated',
  'generated_by',
  'sources',
] as const;

const DATE_FIELDS = ['generated', 'verified', 'stale_after'] as const;

const ABSOLUTE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Failure {
  field: string;
  reason: string;
}

/**
 * True when `value` is `YYYY-MM-DD` naming a day that exists.
 *
 * Checked in UTC and never turned into the value this function returns, for
 * the reason `src/db/connect.ts` gives for reading a `date` column as a
 * string: parsing into a `Date` and reading it back moves a date written for
 * Sydney a day west.
 */
function isAbsoluteDate(value: string): boolean {
  if (!ABSOLUTE_DATE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year && asUtc.getUTCMonth() === month - 1 && asUtc.getUTCDate() === day
  );
}

/**
 * Validates one space note's frontmatter, failing loudly.
 *
 * Returns every failure found rather than the first, so one bad note names
 * everything wrong with it in one pass instead of one failure per run.
 * A `sources/` note never reaches this function: it keeps whatever
 * frontmatter it arrived with, or none, and has no schema to fit.
 */
export function validateFrontmatter(frontmatter: Readonly<Record<string, string | string[]>>): Failure[] {
  const failures: Failure[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = frontmatter[field];
    if (value === undefined || value === '') {
      failures.push({ field, reason: 'required field is missing' });
    }
  }

  for (const key of Object.keys(frontmatter)) {
    if (!(key in FRONTMATTER)) {
      failures.push({ field: key, reason: 'not a field src/vault-mapping.ts maps' });
    }
  }

  const type = frontmatter['type'];
  if (typeof type === 'string' && type !== '' && !(FACT_TYPES as readonly string[]).includes(type)) {
    failures.push({ field: 'type', reason: `"${type}" is not a fact_type: ${FACT_TYPES.join(', ')}` });
  }

  const space = frontmatter['space'];
  if (typeof space === 'string' && space !== '' && !(SPACES as readonly string[]).includes(space)) {
    failures.push({ field: 'space', reason: `"${space}" is not a space: ${SPACES.join(', ')}` });
  }

  const status = frontmatter['status'];
  if (typeof status === 'string' && status !== '' && !(VAULT_STATUSES as readonly string[]).includes(status)) {
    failures.push({
      field: 'status',
      reason: `"${status}" is not a vault status: ${VAULT_STATUSES.join(', ')}`,
    });
  }

  for (const field of DATE_FIELDS) {
    const value = frontmatter[field];
    if (typeof value === 'string' && value !== '' && !isAbsoluteDate(value)) {
      failures.push({ field, reason: `"${value}" is not an absolute YYYY-MM-DD date` });
    }
  }

  return failures;
}
