/**
 * Builds `docs/decisions.md` from the decision blocks in Jira.
 *
 * A ruling that lives only in a Jira comment is invisible to anybody reading
 * this repository, and an agent working here cannot see it at all. Four agents
 * each hit a decision on 3 September 2026 and none could read what had already
 * been settled. This is the file that closes that gap.
 *
 * IT READS TWO SHAPES, AND NEITHER IS PROSE. A question is a warning panel
 * whose first line reads `DECISION NEEDED`. A ruling is a `decisionItem` node,
 * which is what Jira's own decision block writes. Both are structure rather
 * than sentences, so nothing here guesses at an answer from a paragraph.
 *
 * `docs/adr/` still holds the decisions that were hard to reverse. This holds
 * the lighter rulings, and a decision that later meets the three ADR tests in
 * `CLAUDE.md` graduates to one.
 *
 * Run it after a decision lands:
 *
 *     node --experimental-strip-types scripts/decision-register.ts
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE = process.env['KOINON_JIRA_SITE'];
const EMAIL = process.env['KOINON_JIRA_EMAIL'];
const TOKEN = process.env['KOINON_JIRA_TOKEN'];
const PROJECT = 'KPA';

if (!SITE || !EMAIL || !TOKEN) {
  throw new Error(
    'KOINON_JIRA_SITE, KOINON_JIRA_EMAIL and KOINON_JIRA_TOKEN must be set. ' +
      '~/.zshenv exports all three. See docs/runbooks/secrets.md.',
  );
}

/** One ruling, or one question still waiting on one. */
interface Entry {
  key: string;
  status: string;
  question: string;
  recommended: string;
  ruling: string | null;
  /** The day the comment carrying the ruling was written. */
  on: string | null;
}

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

/** Only what this file reads. Jira sends far more on every one of these. */
interface Comment {
  body: unknown;
  created: string;
}

interface Issue {
  key: string;
  fields: {
    status: { name: string };
    comment?: { comments?: Comment[] };
  };
}

interface Page {
  issues?: Issue[];
  isLast?: boolean;
  nextPageToken?: string;
}

/** Every text run under `node`, joined. Jira splits a line at every mark. */
function flatten(node: Node | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(flatten).join('');
}

/** Walks the tree and collects every node of `type`. */
function collect(node: unknown, type: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, type, out);
  } else if (node && typeof node === 'object') {
    const it = node as Node;
    if (it.type === type) out.push(it);
    for (const value of Object.values(node)) collect(value, type, out);
  }
  return out;
}

/** The question a `DECISION NEEDED` warning panel asks, or null. */
function questionIn(body: unknown): string | null {
  for (const panel of collect(body, 'panel')) {
    if (panel.attrs?.['panelType'] !== 'warning') continue;
    const [heading, question] = panel.content ?? [];
    if (flatten(heading).trim() === 'DECISION NEEDED') return flatten(question).trim();
  }
  return null;
}

/** What the comment recommended, read from the line naming it. */
function recommendationIn(body: unknown): string | null {
  for (const para of collect(body, 'paragraph')) {
    const text = flatten(para).trim();
    if (text.startsWith('MY RECOMMENDATION')) {
      return text.replace(/^MY RECOMMENDATION:?\s*/, '').replace(/\.$/, '');
    }
  }
  return null;
}

/**
 * One page of the project's issues, with their comments.
 *
 * `/search/jql` pages by an opaque token rather than by an offset, and it
 * answers a full page with `isLast` false rather than an empty one. A loop
 * built on `startAt` reads page one forever, which is what this cost before it
 * was written down.
 */
async function search(token: string | null): Promise<Page> {
  const url = new URL(`${SITE}/rest/api/3/search/jql`);
  url.searchParams.set('jql', `project=${PROJECT} ORDER BY key ASC`);
  url.searchParams.set('fields', 'summary,status,comment');
  url.searchParams.set('maxResults', '100');
  if (token) url.searchParams.set('nextPageToken', token);

  const answer = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    },
  });
  if (!answer.ok) throw new Error(`Jira answered ${answer.status} to the search.`);
  return (await answer.json()) as Page;
}

/** Every question and every ruling in the project, oldest ticket first. */
async function read(): Promise<Entry[]> {
  const entries: Entry[] = [];

  let token: string | null = null;

  for (;;) {
    const page = await search(token);
    const issues = page.issues ?? [];

    for (const issue of issues) {
      const comments = issue.fields.comment?.comments ?? [];

      let question: string | null = null;
      let recommended: string | null = null;
      let ruling: string | null = null;
      let on: string | null = null;

      for (const comment of comments) {
        question = questionIn(comment.body) ?? question;
        recommended = recommendationIn(comment.body) ?? recommended;

        for (const item of collect(comment.body, 'decisionItem')) {
          if (item.attrs?.['state'] !== 'DECIDED') continue;
          ruling = flatten(item).trim();
          on = comment.created.slice(0, 10);
        }
      }

      // A question with no ruling is still waiting, whether it reached the
      // queue by the `decision-required` label or by the status. KPA is
      // team-managed, so its workflow sits outside the public API and the
      // label carries the queue until the status is wired in by hand.
      if (question || ruling) {
        entries.push({
          key: issue.key,
          status: issue.fields.status.name,
          question: question ?? '(the question is not in a warning panel)',
          recommended: recommended ?? '',
          ruling,
          on,
        });
      }
    }

    if (page.isLast === true) break;
    token = page.nextPageToken ?? null;
    if (!token) break;
  }

  return entries;
}

/** A cell that cannot break the table it sits in. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function render(entries: Entry[], today: string): string {
  const decided = entries.filter((entry) => entry.ruling !== null);
  const waiting = entries.filter((entry) => entry.ruling === null);
  const link = (key: string) => `[${key}](${SITE}/browse/${key})`;

  const lines = [
    '# The decision register',
    '',
    '`scripts/decision-register.ts` writes this file from the decision blocks in',
    'Jira. **Do not edit it by hand**, because the next run overwrites it. Rule on',
    'a decision in Jira and run the script again.',
    '',
    'A question is a warning panel reading `DECISION NEEDED`. A ruling is a Jira',
    'decision block, which carries its own state. Both are structure rather than',
    'prose, so nothing here reads an answer out of a sentence.',
    '',
    '`docs/adr/` still holds the decisions that were hard to reverse. This holds',
    'the lighter rulings. A decision that meets the three tests in `CLAUDE.md`',
    'graduates to an ADR, and this register then cites it.',
    '',
    `Generated ${today}. ${String(decided.length)} decided, ${String(waiting.length)} waiting.`,
    '',
    '## Decided',
    '',
  ];

  if (decided.length === 0) {
    lines.push('Nothing yet.', '');
  } else {
    lines.push('| On | Ticket | The question | The ruling |', '|---|---|---|---|');
    for (const entry of decided) {
      lines.push(
        `| ${entry.on ?? ''} | ${link(entry.key)} | ${cell(entry.question)} | ${cell(entry.ruling ?? '')} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Waiting on a ruling', '');

  if (waiting.length === 0) {
    lines.push('Nothing waiting.', '');
  } else {
    lines.push('| Ticket | The question | Recommended |', '|---|---|---|');
    for (const entry of waiting) {
      lines.push(`| ${link(entry.key)} | ${cell(entry.question)} | ${cell(entry.recommended)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const today = new Date().toISOString().slice(0, 10);
const entries = await read();
const target = path.join(import.meta.dirname, '..', 'docs', 'decisions.md');
await writeFile(target, render(entries, today), 'utf8');

const decided = entries.filter((entry) => entry.ruling !== null).length;
console.log(`decisions OK: ${String(decided)} decided, ${String(entries.length - decided)} waiting`);
