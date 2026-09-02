/**
 * The policy engine: allowed or denied, decided from a table.
 *
 * ADR-0005 chose a table over a paragraph in a prompt, because a prompt cannot
 * be tested and fails silently. So there is no prompt text and no model call
 * anywhere in this file, and there must never be one. A rule is a row.
 *
 * **The default is to deny.** An empty table denies, a database error denies,
 * an action no rule describes denies, and a malformed row denies. ADR-0005
 * requires it: a policy layer that fails open is not a policy layer. This is
 * the same shape `src/memory/gates.ts` takes, where a gate that throws rejects.
 *
 * The engine returns a verdict and writes nothing. KPA-82 wraps it in the one
 * function that records the attempt and then runs the effect.
 */
import type { ClientBase } from 'pg';

/** The four spaces `migrations/001_core_schema.sql` defines. */
export type Space = 'collibra' | 'koinon' | 'personal' | 'shared';

/** What the worker asks about before it acts. */
export interface Proposal {
  /** A dotted key from `PERMITTED` or `FORBIDDEN`. Anything else denies. */
  action: string;
  /** What the action acts on: a thread id, a fact path, an event id. */
  target: string;
  /** The space the action happens in. */
  space: Space;
  /**
   * The spaces the material behind the action came from. Defaults to the one
   * the action happens in, which crosses nothing.
   */
  draws?: Space[];
}

export interface Verdict {
  outcome: 'allowed' | 'denied';
  /**
   * The policy this verdict cites, written straight into `audit.rule`.
   *
   * Always set on a denial, which `audit_denial_names_a_rule` requires. Set on
   * an allowance only when a rule flagged it, which today means one rule: an
   * allowed verdict naming `space.collibra-koinon-separation` is the crossing
   * flag the brief asks for.
   */
  rule: string | null;
  reason: string;
}

/** The rule the engine cites when it can cite nothing else. `migrations/012`. */
export const DENY_BY_DEFAULT = 'deny-by-default';

/** The rule that flags a crossing and never blocks one. */
export const SEPARATION = 'space.collibra-koinon-separation';

/**
 * Actions no rule denies, from the brief's scope table.
 *
 * This is an allowlist, so adding a capability means adding it here. That is
 * the point: an action nobody has listed is an action nobody has judged.
 */
export const PERMITTED: ReadonlySet<string> = new Set([
  'mail.draft',
  'mail.label',
  'calendar.hold',
  'calendar.accept',
  'drive.create',
  'drive.edit',
  'drive.move',
  'fact.write',
  'fact.retire',
]);

/** Actions a rule denies, and the rule that denies each. */
export const FORBIDDEN: ReadonlyMap<string, string> = new Map([
  ['mail.send', 'mail.send.never-unprompted'],
  ['mail.delete', 'never-delete-or-destructively-edit'],
  ['calendar.delete', 'never-delete-or-destructively-edit'],
  ['drive.delete', 'never-delete-or-destructively-edit'],
  ['fact.delete', 'never-delete-or-destructively-edit'],
  ['history.overwrite', 'never-delete-or-destructively-edit'],
  ['fact.verify', 'fact.verify.never-by-agent'],
]);

/** Every key the engine needs before it may allow anything. */
const REQUIRED: readonly string[] = [
  DENY_BY_DEFAULT,
  SEPARATION,
  ...new Set(FORBIDDEN.values()),
];

interface Rule {
  key: string;
  governs: string;
  effect: string;
  absolute: boolean;
  enabled: boolean;
}

function because(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads every rule and checks the table is intact.
 *
 * It throws rather than returning a partial table, because a partial table is
 * the failure this engine exists to survive. One broken row makes the whole
 * table untrustworthy: nothing can tell whether the row that governs this
 * action is the one that was damaged.
 */
async function load(client: ClientBase): Promise<Map<string, Rule>> {
  const read = await client.query<Rule>(
    'SELECT key, governs, effect, absolute, enabled FROM policies',
  );

  const table = new Map(read.rows.map((rule) => [rule.key, rule]));

  for (const key of REQUIRED) {
    const rule = table.get(key);
    if (!rule) {
      throw new Error(`${key} is missing`);
    }
    if (typeof rule.absolute !== 'boolean' || typeof rule.enabled !== 'boolean') {
      throw new Error(`${key} carries a non-boolean absolute or enabled`);
    }
    if (rule.governs.trim() === '' || rule.effect.trim() === '') {
      throw new Error(`${key} says nothing about what it governs or what it does`);
    }
  }

  return table;
}

/**
 * The spaces a proposal drew on, each named once and `shared` dropped.
 *
 * `shared` is the space the wall does not divide, so citing it crosses
 * nothing. ADR-0018 decided that, and `apps/web/lib/space.ts` says the same
 * thing for the interface. The two are separate packages, so this is a second
 * copy of three lines rather than an import across the boundary.
 */
export function crossed(spaces: readonly Space[]): Space[] {
  return [...new Set(spaces)].filter((space) => space !== 'shared');
}

/**
 * Decides whether the worker may act, and names the rule either way.
 *
 * Read the four branches in order. Anything that is not a clean allowance is a
 * denial, and every denial names a key `policies` holds.
 */
export async function decide(client: ClientBase, proposal: Proposal): Promise<Verdict> {
  let table: Map<string, Rule>;
  try {
    table = await load(client);
  } catch (error) {
    return {
      outcome: 'denied',
      rule: DENY_BY_DEFAULT,
      reason: `the policy table did not load, so nothing is allowed: ${because(error)}`,
    };
  }

  const forbidding = FORBIDDEN.get(proposal.action);
  if (forbidding === undefined && !PERMITTED.has(proposal.action)) {
    return {
      outcome: 'denied',
      rule: DENY_BY_DEFAULT,
      reason: `no rule describes the action ${proposal.action}`,
    };
  }

  if (forbidding !== undefined) {
    // A rule Shane may not switch off denies whether it is enabled or not.
    // That is what `absolute` is for.
    const rule = table.get(forbidding)!;
    if (rule.absolute || rule.enabled) {
      const off = rule.enabled ? '' : ' It is absolute, so switching it off changes nothing.';
      return {
        outcome: 'denied',
        rule: forbidding,
        reason: `${rule.effect}${off}`,
      };
    }
  }

  // The separation rule flags and never blocks, so it runs after every denial
  // has had its say. The brief is explicit: retrieval filters by space and
  // nothing here prevents a crossing. ADR-0006.
  const separation = table.get(SEPARATION)!;
  const spaces = crossed(proposal.draws ?? [proposal.space]);
  if (separation.enabled && spaces.length > 1) {
    return {
      outcome: 'allowed',
      rule: SEPARATION,
      reason: `flagged: draws on ${spaces.join(' and ')}. ${separation.effect}`,
    };
  }

  return { outcome: 'allowed', rule: null, reason: `no rule denies ${proposal.action}` };
}
