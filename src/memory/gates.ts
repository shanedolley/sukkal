/**
 * The four gates, as code.
 *
 * They were prose in the vault's `CLAUDE.md` that a model was asked to follow.
 * Making them functions with tests is the point of the whole slice.
 *
 * All four must pass or the candidate stays out, and **the default is to
 * reject**: a gate that throws rejects, and an answer that is neither a clean
 * pass nor a clean fail rejects. Silence must never read as approval.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClientBase } from 'pg';
import type { Inference } from './inference.ts';

export interface Candidate {
  /** The node this came from: the source it was extracted out of. */
  subjectId: string;
  /** Where the fact will live, relative to the vault root. Unique. */
  path: string;
  type: string;
  title: string;
  description: string;
  space: string;
  status: string;
  /** The claim itself, in prose. This is what gates 1 and 2 judge. */
  text: string;
  /** The date the fact becomes true. Defaults to today. */
  validFrom?: string;
  /** Paths of live facts this candidate retires. Empty is the normal case. */
  contradicts?: string[];
}

export interface GateResult {
  pass: boolean;
  reason: string;
}

export type Gate = (candidate: Candidate) => Promise<GateResult>;

const PROMPTS = path.join(import.meta.dirname, 'prompts');

/**
 * Reads a model's answer.
 *
 * A hedge, a refusal or anything malformed is an error, and an error rejects.
 */
export function verdict(answer: string): GateResult {
  const [line = ''] = answer.trim().split('\n');
  const parsed = /^(PASS|FAIL)\b[\s:.-]*(.*)$/.exec(line.trim());
  if (!parsed) {
    return { pass: false, reason: `unreadable answer: ${line.trim().slice(0, 80)}` };
  }
  return {
    pass: parsed[1] === 'PASS',
    reason: parsed[2]?.trim() || parsed[1]!.toLowerCase(),
  };
}

/**
 * A gate that asks the model.
 *
 * The prompt is read from its file on every call, so a missing or renamed
 * prompt throws and the candidate is rejected rather than silently judged by
 * an empty instruction.
 */
function judged(model: Inference, name: string): Gate {
  return async (candidate) => {
    const template = await readFile(path.join(PROMPTS, `${name}.md`), 'utf8');
    return verdict(await model.ask(name, template.replace('{{candidate}}', candidate.text)));
  };
}

/** Gate 1: it will still be true in a month. */
export const stillTrueInAMonth = (model: Inference): Gate =>
  judged(model, 'gate-1-still-true-in-a-month');

/** Gate 2: two separate days, or Shane stated it once with authority. */
export const worthRecording = (model: Inference): Gate =>
  judged(model, 'gate-2-worth-recording');

/**
 * Gate 3: nothing already records it.
 *
 * Checked before writing, never after. Appending first and reconciling later
 * leaves two answers standing and a reader cannot tell which one is current.
 *
 * ponytail: matches on the title, case-insensitively. That rejects a duplicate
 * and passes a candidate that merely mentions the same entity, which is what
 * the gate is for. Once KPA-12 fills the embeddings, compare vectors instead
 * and this catches a duplicate worded differently.
 */
export function notAlreadyRecorded(client: ClientBase): Gate {
  return async (candidate) => {
    const existing = await client.query<{ path: string }>(
      'SELECT path FROM facts WHERE lower(title) = lower($1) AND valid_to IS NULL',
      [candidate.title],
    );
    const found = existing.rows[0];
    return found
      ? { pass: false, reason: `already recorded by ${found.path}` }
      : { pass: true, reason: 'nothing already records it' };
  };
}

/**
 * Gate 4: it contradicts nothing, or it retires what it contradicts.
 *
 * This checks that the retirement is possible. `admit` is what makes it happen
 * in the same transaction as the replacement.
 *
 * ponytail: the candidate names what it contradicts. Detecting a contradiction
 * nobody declared is a judgment call, so it belongs to the extraction step
 * that builds candidates, not here.
 */
export function retiresWhatItContradicts(client: ClientBase): Gate {
  return async (candidate) => {
    const contradicts = candidate.contradicts ?? [];
    if (contradicts.length === 0) {
      return { pass: true, reason: 'contradicts nothing' };
    }

    const live = await client.query<{ path: string }>(
      'SELECT path FROM facts WHERE path = ANY($1) AND valid_to IS NULL',
      [contradicts],
    );
    const found = new Set(live.rows.map((row) => row.path));
    const missing = contradicts.filter((one) => !found.has(one));

    return missing.length > 0
      ? { pass: false, reason: `nothing live to retire at ${missing.join(', ')}` }
      : { pass: true, reason: `retires ${contradicts.join(', ')}` };
  };
}

function because(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs every gate, writes the fact if all four pass, and records the reason if
 * one does not.
 *
 * A candidate already rejected is not raised again. That is what stops the
 * weekly review proposing the same thing every Sunday.
 */
export async function admit(
  client: ClientBase,
  model: Inference,
  candidate: Candidate,
): Promise<GateResult> {
  const before = await client.query<{ reason: string }>(
    'SELECT reason FROM rejections WHERE subject_id = $1 AND candidate = $2',
    [candidate.subjectId, candidate.text],
  );
  const earlier = before.rows[0];
  if (earlier) {
    return { pass: false, reason: `raised before and rejected. ${earlier.reason}` };
  }

  const gates: Gate[] = [
    stillTrueInAMonth(model),
    worthRecording(model),
    notAlreadyRecorded(client),
    retiresWhatItContradicts(client),
  ];

  for (const [index, gate] of gates.entries()) {
    let result: GateResult;
    try {
      result = await gate(candidate);
    } catch (error) {
      result = { pass: false, reason: `threw: ${because(error)}` };
    }

    if (!result.pass) {
      const reason = `gate ${index + 1}: ${result.reason}`;
      await client.query(
        'INSERT INTO rejections (subject_id, candidate, reason) VALUES ($1, $2, $3)',
        [candidate.subjectId, candidate.text, reason],
      );
      return { pass: false, reason };
    }
  }

  await write(client, candidate);
  return { pass: true, reason: 'all four gates passed' };
}

/**
 * Writes the fact and retires what it replaces, in one transaction.
 *
 * Two answers must never both be live, so either both writes land or neither
 * does.
 */
async function write(client: ClientBase, candidate: Candidate): Promise<void> {
  await client.query('BEGIN');
  try {
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;

    const validFrom = candidate.validFrom ?? new Date().toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, status, valid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, candidate.path, candidate.type, candidate.title, candidate.description,
        candidate.space, candidate.status, validFrom],
    );

    for (const contradicted of candidate.contradicts ?? []) {
      const retired = await client.query<{ id: string }>(
        'UPDATE facts SET valid_to = $2 WHERE path = $1 AND valid_to IS NULL RETURNING id',
        [contradicted, validFrom],
      );
      const target = retired.rows[0];
      if (!target) {
        throw new Error(`nothing live to retire at ${contradicted}`);
      }
      await client.query(
        "INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, 'supersedes')",
        [id, target.id],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
