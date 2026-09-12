/**
 * The one path to an outbound action.
 *
 * Nothing approves what Sukkal does before it does it, so the audit log is the
 * whole safety net. A call site that reaches Gmail without passing through
 * here is an action nobody can find afterwards, which is the failure ADR-0005
 * built the log to catch. So this function asks the engine, writes the row,
 * and only then runs the effect. There is no second order to run them in.
 *
 * **An attempt and its outcome are two rows.** ADR-0015 decided that, and
 * `migrations/014_audit_attempt.sql` carries it. An allowed action writes an
 * `attempted` row before the call and an `allowed` row after it, paired by the
 * attempt row's id. A process that dies between the two leaves the attempt
 * standing, which says the right thing: something was tried and nobody knows
 * how it ended. A denial writes one row and is whole, because nothing ran.
 *
 * **Nothing here opens a transaction, and nothing here may.** The outcome row
 * has to survive a failed call, and a transaction wrapping the effect would
 * roll the attempt row back with it and leave the log silent about the worst
 * case it has. Each `INSERT` below runs on its own implicit transaction.
 *
 * **A denial Shane has to decide about also reaches the briefing.** ADR-0005
 * asks for that in as many words: the log surfaces on the screen he opens
 * rather than sitting in a table nobody reads, because the markdown system
 * left its findings in a log for three days. So such a denial opens a
 * `needs_you` row of kind `denied-action`, and `needsADecision` below says
 * which denials those are.
 *
 * `engine.ts` returns a verdict and writes nothing, so there is one path from
 * a decision to a row rather than two.
 *
 * **This is the one path to an outbound action, and not the one writer of the
 * log.** `record` in `src/auth/attempts.ts` writes a row for every sign-in,
 * because KPA-78 asks for it and a sign-in is not an outbound action: it
 * reaches nothing, and no rule judges whether somebody may try to prove who
 * they are, so `decide` would deny every one by default. It cites the
 * `auth.sign-in` row migration 026 writes, the way this cites `deny-by-default`.
 */
import type { ClientBase } from 'pg';
import { decide, DENY_BY_DEFAULT, FORBIDDEN, PERMITTED, type Proposal } from './engine.ts';

/**
 * Permission to make one outbound call, which only `act` mints.
 *
 * An outbound wrapper takes one as its first argument. Nothing else can
 * produce one, so a call site that tries to reach Gmail on its own does not
 * compile, and the audit write cannot be skipped by forgetting it.
 *
 * It binds a wrapper that asks for it. It cannot bind an author who writes a
 * wrapper that does not, and no type can. Every wrapper takes one.
 */
declare const minted: unique symbol;
export interface Permit {
  readonly [minted]: true;
}

/** The call itself. It returns the sentence the log records as `result`. */
export type Effect = (permit: Permit) => Promise<string>;

/** What an attempt row records as its result, because it has no other yet. */
export const NOT_YET_KNOWN = 'Attempted. Nothing has recorded how it ended yet.';

/** What a denial records, because the effect never ran. */
const NOTHING_RAN = 'Nothing to reverse. The action did not run.';

/**
 * A proposal, plus the three fields the log needs before anything happens.
 *
 * `intent`, `before` and `reverse` are all known in advance, which is why
 * ADR-0015 could leave `result` and `reverse` NOT NULL on the attempt row.
 * The fourth field, `result`, is the only one the answer decides.
 *
 * `audit` carries no target column, so name the target in the `intent`: the
 * thread, the fact path or the event this acts on.
 */
export interface Action extends Proposal {
  /** What it means to do, in Shane's words. */
  intent: string;
  /** The state before it acts, so a reader can tell what changed. */
  before: string;
  /** How to undo it. An attempt that goes wrong is read from this line. */
  reverse: string;
}

/** What `act` tells its caller. The log holds the same story in full. */
export interface Acted {
  /** The verdict. `attempted` is a row state, never an answer. */
  outcome: 'allowed' | 'denied';
  /** The policy the verdict cites. Always set on a denial. */
  rule: string | null;
  /** The engine's own words for the verdict. */
  reason: string;
  /** The id of the last row written: the denial, or the outcome. */
  audit: string;
  /** What went into `audit.result`. */
  result: string;
  /** The error the effect threw. The outcome row was written either way. */
  failure?: Error;
}

/** The one permit. A brand carries no data, so one value serves every call. */
const PERMIT = {} as Permit;

/** The four fields the brief requires. An empty one records nothing. */
function checked(action: Action): void {
  for (const field of ['intent', 'before', 'reverse'] as const) {
    if (action[field].trim() === '') {
      throw new Error(`${field} is empty, so the audit row would say nothing`);
    }
  }
}

/**
 * Writes one row and returns its id.
 *
 * It runs one statement and opens no transaction. A denial that names no rule
 * fails here rather than being recorded under a rule that did not fire, which
 * is the trade ADR-0021 already refused to make.
 */
async function record(
  client: ClientBase,
  action: Action,
  row: {
    outcome: 'allowed' | 'denied' | 'attempted';
    rule: string | null;
    result: string;
    reverse: string;
    attempt: string | null;
  },
): Promise<string> {
  const written = await client.query<{ id: string }>(
    `INSERT INTO audit (action, intent, before, outcome, result, reverse, space, rule, attempt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      action.action, action.intent, action.before, row.outcome,
      row.result, row.reverse, action.space, row.rule, row.attempt,
    ],
  );
  return written.rows[0]!.id;
}

/**
 * Whether a denial waits on Shane, or only on the policy table being repaired.
 *
 * A named rule denies an action Shane's own policy judged, and he is the one
 * who can do it by hand instead. That denial reaches the briefing.
 *
 * `deny-by-default` covers four failures and ADR-0021 names them: an empty
 * table, a database error, a malformed row, and an action no rule describes.
 * Only the last judged the action. The other three say the engine could not
 * read its own rules, so they ask an operator for a repair rather than Shane
 * for a decision, and an item raised on one would name a rule that never
 * fired. Restoring the table is the fix ADR-0021 gives, and a failure that
 * loud already shows on every action rather than on this one.
 *
 * So the test reads the allowlist in this process and never the table.
 * `PERMITTED` and `FORBIDDEN` are code, so they answer whoever asks, and a
 * database that refused to load cannot change the answer. An action neither
 * set names is an action nobody has judged, which is the decision this raises.
 */
function needsADecision(action: string, rule: string | null): boolean {
  return rule !== DENY_BY_DEFAULT || !(PERMITTED.has(action) || FORBIDDEN.has(action));
}

/**
 * Opens one `needs_you` row for a denial, unless one already stands open.
 *
 * The guard is the `NOT EXISTS` shape `src/memory/sweep.ts` uses, over a
 * different question. The sweep matches `raised_for`, the date one staleness
 * fell due, and it reads closed rows as well as open ones. A denial has
 * neither a date nor a fact, so this matches the attempt through the audit
 * entry the row names: the same action, in the same space, meaning the same
 * thing. It reads the open rows alone, because closing an item settles that
 * denial and the next attempt deserves a fresh one.
 *
 * The repeat still writes its own audit row. The log records every attempt
 * and the briefing carries one item, which is the split ADR-0005 asks for.
 *
 * `raised_for` stays null, as `needs_you_raised_for_is_a_deadline` requires of
 * every kind but `deadline`. So does `entity`: nothing resolves one yet and a
 * refused send names no fact to read one from, which is why migration 010
 * dropped the `NOT NULL`.
 *
 * Nothing copies the rule here. `audit_id` names the entry that refused it and
 * `apps/web/lib/needs-you.ts` joins that entry for `a.rule`, so one answer
 * lives in one place.
 *
 * A statement the database refuses throws, and the denial row already stands.
 * That order is the safe one: the log keeps the denial, and a briefing this
 * cannot write fails aloud rather than losing the item in silence.
 */
async function raise(client: ClientBase, action: Action, audit: string): Promise<void> {
  await client.query(
    `INSERT INTO needs_you (kind, title, detail, space, audit_id)
       SELECT 'denied-action', $1, $2, $3::space, $4
        WHERE NOT EXISTS (
          SELECT 1
            FROM needs_you n
            JOIN audit a ON a.id = n.audit_id
           WHERE n.kind = 'denied-action' AND n.closed_at IS NULL
             AND n.space = $3::space AND a.action = $5 AND a.intent = $6
        )`,
    [
      `Refused: ${action.action}`,
      `Attempted ${action.action} on ${action.target}. ${action.intent} Nothing ran.`,
      action.space,
      audit,
      action.action,
      action.intent,
    ],
  );
}

/**
 * Decides, records, and only then acts.
 *
 * Read the two paths. A denial writes one row, raises the briefing item that
 * row earns, and returns without touching `effect`. An allowance writes the
 * attempt row, runs `effect`, and writes the outcome row whether the call
 * returned or threw.
 *
 * It throws before writing anything when a field is empty, and throws when the
 * database refuses a row. Both leave the action undone, which is the direction
 * this whole file falls in.
 */
export async function act(
  client: ClientBase,
  action: Action,
  effect: Effect,
): Promise<Acted> {
  checked(action);

  const verdict = await decide(client, action);

  if (verdict.outcome === 'denied') {
    const result = `Refused, and nothing ran. ${verdict.reason}`;
    const audit = await record(client, action, {
      outcome: 'denied',
      rule: verdict.rule,
      result,
      reverse: NOTHING_RAN,
      attempt: null,
    });
    if (needsADecision(action.action, verdict.rule)) {
      await raise(client, action, audit);
    }
    return { outcome: 'denied', rule: verdict.rule, reason: verdict.reason, audit, result };
  }

  const attempt = await record(client, action, {
    outcome: 'attempted',
    rule: verdict.rule,
    result: NOT_YET_KNOWN,
    reverse: action.reverse,
    attempt: null,
  });

  // Everything from here writes the outcome row. A throw from `effect` is an
  // answer, not an escape: the call may well have reached Gmail before it
  // failed, so `reverse` stays the caller's and the row says what is unclear.
  let result: string;
  let failure: Error | undefined;
  try {
    result = await effect(PERMIT);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    result = `The call failed, so the action may or may not have happened: ${failure.message}`;
  }

  const audit = await record(client, action, {
    outcome: 'allowed',
    rule: verdict.rule,
    result,
    reverse: action.reverse,
    attempt,
  });

  return {
    outcome: 'allowed',
    rule: verdict.rule,
    reason: verdict.reason,
    audit,
    result,
    ...(failure ? { failure } : {}),
  };
}
