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
import { type Comment, type Entry, entriesForIssue } from './decision-entries.ts';

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

/**
 * Every question and every ruling in the project, oldest ticket first.
 *
 * A `Decision required` status with no entry at all cannot happen: an issue
 * with no question and no ruling contributes nothing, and `entriesForIssue`
 * is where that filter lives. Filter 10047 reads the `Decision required`
 * status, which is the queue Shane works from.
 */
async function read(): Promise<Entry[]> {
  const entries: Entry[] = [];

  let token: string | null = null;

  for (;;) {
    const page = await search(token);
    const issues = page.issues ?? [];

    for (const issue of issues) {
      entries.push(
        ...entriesForIssue({
          key: issue.key,
          status: issue.fields.status.name,
          comments: issue.fields.comment?.comments ?? [],
        }),
      );
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
    `Generated ${today}. ${String(decided.length)} questions decided, ${String(waiting.length)} questions waiting.`,
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
console.log(
  `decisions OK: ${String(decided)} questions decided, ${String(entries.length - decided)} questions waiting`,
);
