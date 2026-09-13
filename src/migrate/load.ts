/**
 * Writes what `readVault` found into Postgres, in one transaction.
 *
 * Slice one built every piece of the migration except this. KPA-5 reads and
 * validates the notes, KPA-6 resolves their links, KPA-7 parses their tasks,
 * and none of them writes a row: the only load before KPA-13 lived inline in
 * `test/advisories.test.ts`. KPA-13 cannot verify a migration nothing runs, so
 * the load moved here, and that test now calls it.
 *
 * **It refuses a database that already holds memory**, naming what it found,
 * rather than writing a second copy or topping one up. That is REQ-007's rule
 * for the migration, and it is what makes a half-finished run safe: the
 * transaction rolls back, the tables stay empty, and the next run starts
 * clean.
 *
 * What lands where:
 *
 * - A source is a node and a `sources` row holding its body verbatim.
 * - A fact is a node and a `facts` row. `valid_from` takes `generated`, because
 *   the day of the migration is not the day a fact became true, and `asAt`
 *   reads that column.
 * - An edge resolves through `edgesFor`. A `url` or `unresolved` target is one
 *   node per distinct ref, shared by every edge naming it, and a fact linking
 *   itself is no edge, which is what `edges_not_self` says.
 * - A task is a `tasks` row on the fact whose body holds it.
 * - An open question on `index.md` is a `needs_you` row of kind `question`
 *   (ADR-0012), on the fact its Note cell names.
 *
 * A question whose Note names no fact has no space, and `needs_you.space`
 * requires one. It fails the load rather than taking a space from nowhere,
 * which is the guess the vault's never-guess rule forbids.
 */
import type { ClientBase } from 'pg';

import { edgesFor, knownTargets } from './edges.ts';
import type { FactNote, Frontmatter, VaultReport } from './read-vault.ts';
import { parseTasks } from './tasks.ts';

export interface LoadCounts {
  facts: number;
  sources: number;
  tasks: number;
  questions: number;
  edges: number;
}

export interface IndexQuestion {
  /** The name inside the Note cell's `[[ ]]`. */
  note: string;
  question: string;
  answer: string;
  /** The Asked cell, `YYYY-MM-DD`, or null when it is empty. */
  asked: string | null;
}

/**
 * The rows of the `## Questions for you` table on `index.md`.
 *
 * The table's header and its separator are not rows, and nothing past the
 * next heading belongs to it. A cell may hold a `|` only inside a wikilink
 * alias, and the vault writes none, so a plain split is exact here.
 */
export function indexQuestions(indexMd: string): IndexQuestion[] {
  const rows: IndexQuestion[] = [];
  let inside = false;
  let pastSeparator = false;

  for (const line of indexMd.split('\n')) {
    if (line.startsWith('## ')) {
      inside = line.trim() === '## Questions for you';
      pastSeparator = false;
      continue;
    }
    if (!inside || !line.startsWith('|')) {
      continue;
    }
    if (/^\|[\s\-:|]+\|?$/.test(line.trim())) {
      pastSeparator = true;
      continue;
    }
    if (!pastSeparator) {
      continue;
    }

    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    const link = /\[\[([^\]|#]+)/.exec(cells[0] ?? '');
    rows.push({
      note: link ? link[1]!.trim() : (cells[0] ?? ''),
      question: cells[1] ?? '',
      answer: cells[2] ?? '',
      asked: /^\d{4}-\d{2}-\d{2}$/.test(cells[3] ?? '') ? cells[3]! : null,
    });
  }

  return rows;
}

/** One frontmatter scalar, or null when the note leaves it out. The reader
 *  already validated every date's shape, so a date passes through as text. */
function scalarOf(frontmatter: Frontmatter, key: string): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A frontmatter list, whichever way the note wrote it. */
function listOf(frontmatter: Frontmatter, key: string): string[] {
  const value = frontmatter[key];
  if (value === undefined || value === '') {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

async function insertFact(client: ClientBase, fact: FactNote): Promise<string> {
  const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('fact') RETURNING id");
  const id = node.rows[0]!.id;
  const fm = fact.frontmatter;
  await client.query(
    `INSERT INTO facts (id, path, type, title, description, space, state, tags, project,
                        generated, generated_by, verified, verified_by, stale_after, valid_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($10::date, CURRENT_DATE))`,
    [
      id,
      fact.file,
      fm['type'],
      fm['title'],
      fm['description'],
      fact.space,
      fact.state,
      listOf(fm, 'tags'),
      listOf(fm, 'project'),
      scalarOf(fm, 'generated'),
      scalarOf(fm, 'generated_by'),
      scalarOf(fm, 'verified'),
      scalarOf(fm, 'verified_by'),
      scalarOf(fm, 'stale_after'),
    ],
  );
  return id;
}

/** Loads the vault. Throws, and writes nothing, when memory already exists. */
export async function loadVault(
  client: ClientBase,
  report: Pick<VaultReport, 'facts' | 'sources'>,
  indexMd: string | null,
): Promise<LoadCounts> {
  const held = await client.query<{ facts: string; sources: string; nodes: string }>(
    `SELECT (SELECT count(*) FROM facts) AS facts,
            (SELECT count(*) FROM sources) AS sources,
            (SELECT count(*) FROM nodes) AS nodes`,
  );
  const found = held.rows[0]!;
  if (found.facts !== '0' || found.sources !== '0' || found.nodes !== '0') {
    throw new Error(
      `this database already holds memory: ${found.facts} facts, ${found.sources} sources and ` +
        `${found.nodes} nodes. The load refuses rather than write a second copy. Load into an empty database.`,
    );
  }

  const counts: LoadCounts = { facts: 0, sources: 0, tasks: 0, questions: 0, edges: 0 };
  const known = knownTargets(report.facts, report.sources);
  const nodeByPath = new Map<string, string>();
  const nodeByRef = new Map<string, string>();

  await client.query('BEGIN');
  try {
    for (const source of report.sources) {
      const node = await client.query<{ id: string }>("INSERT INTO nodes (kind) VALUES ('source') RETURNING id");
      const id = node.rows[0]!.id;
      nodeByPath.set(source.file, id);
      await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [id, source.file, source.body]);
      counts.sources += 1;
    }

    const factByPath = new Map<string, FactNote>();
    for (const fact of report.facts) {
      nodeByPath.set(fact.file, await insertFact(client, fact));
      factByPath.set(fact.file, fact);
      counts.facts += 1;
    }

    for (const fact of report.facts) {
      const fromId = nodeByPath.get(fact.file)!;

      for (const edge of edgesFor(fact, known)) {
        let toId: string;
        if (edge.target.kind === 'fact' || edge.target.kind === 'source') {
          toId = nodeByPath.get(edge.target.path)!;
        } else {
          const key = JSON.stringify([edge.target.kind, edge.target.ref]);
          const existing = nodeByRef.get(key);
          if (existing === undefined) {
            const node = await client.query<{ id: string }>(
              'INSERT INTO nodes (kind, ref) VALUES ($1, $2) RETURNING id',
              [edge.target.kind, edge.target.ref],
            );
            toId = node.rows[0]!.id;
            nodeByRef.set(key, toId);
          } else {
            toId = existing;
          }
        }
        if (toId === fromId) {
          continue;
        }
        const written = await client.query(
          'INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [fromId, toId, edge.kind],
        );
        counts.edges += written.rowCount ?? 0;
      }

      for (const task of parseTasks(fact.body)) {
        await client.query(
          'INSERT INTO tasks (fact_id, raw_line, text, due, start, done) VALUES ($1, $2, $3, $4, $5, $6)',
          [fromId, task.rawLine, task.text, task.due, task.start, task.done],
        );
        counts.tasks += 1;
      }
    }

    for (const row of indexMd === null ? [] : indexQuestions(indexMd)) {
      const factPath = known.facts.get(row.note);
      const fact = factPath === undefined ? undefined : factByPath.get(factPath);
      if (fact === undefined || factPath === undefined) {
        throw new Error(
          `index.md asks a question on [[${row.note}]], which is no fact, so it has no space to raise it in: ${row.question}`,
        );
      }
      const detail = row.answer === '' ? row.question : `${row.question}\n\nAnswered on index.md: ${row.answer}`;
      await client.query(
        `INSERT INTO needs_you (kind, title, detail, space, fact_id, raised_at)
         VALUES ('question', $1, $2, $3, $4, COALESCE($5::date::timestamptz, now()))`,
        [fact.frontmatter['title'], detail, fact.space, nodeByPath.get(factPath), row.asked],
      );
      counts.questions += 1;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return counts;
}
