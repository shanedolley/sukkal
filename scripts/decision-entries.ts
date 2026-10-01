/**
 * The pure part of `scripts/decision-register.ts`: turning one issue's
 * comments into decision-register entries. Importable on its own, with no
 * environment variable and no network call, so a test can build comment
 * bodies by hand and check the result.
 *
 * One entry is one question. A ticket carrying two `DECISION NEEDED` panels
 * produces two entries, each with its own recommendation. A `decisionItem`
 * carries no reliable reference to the question it answers: see the comment
 * on `entriesForIssue` for what was checked and why the pairing rule refuses
 * to guess once a ticket has more than one open question.
 */

export type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

/** Only what this file reads. Jira sends far more on every one of these. */
export interface Comment {
  body: unknown;
  created: string;
}

/** One ruling, or one question still waiting on one. */
export interface Entry {
  key: string;
  status: string;
  question: string;
  recommended: string;
  ruling: string | null;
  /** The day the comment carrying the ruling was written. */
  on: string | null;
}

/** Every text run under `node`, joined. Jira splits a line at every mark. */
export function flatten(node: Node | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(flatten).join('');
}

/** Walks the tree and collects every node of `type`. */
export function collect(node: unknown, type: string, out: Node[] = []): Node[] {
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
export function questionIn(body: unknown): string | null {
  for (const panel of collect(body, 'panel')) {
    if (panel.attrs?.['panelType'] !== 'warning') continue;
    const [heading, question] = panel.content ?? [];
    if (flatten(heading).trim() === 'DECISION NEEDED') return flatten(question).trim();
  }
  return null;
}

/** What the comment recommended, read from the line naming it. */
export function recommendationIn(body: unknown): string | null {
  for (const para of collect(body, 'paragraph')) {
    const text = flatten(para).trim();
    if (text.startsWith('MY RECOMMENDATION')) {
      return text.replace(/^MY RECOMMENDATION:?\s*/, '').replace(/\.$/, '');
    }
  }
  return null;
}

/**
 * Every question and every ruling on one issue, oldest comment first.
 *
 * A `decisionItem` carries no fixed reference to the question it answers.
 * Checked on 1 October 2026 against two real rulings: `GET
 * /rest/api/3/issue/KPA-80/comment` returns a `parentId` on the ruling
 * comment, naming its question comment. `GET
 * /rest/api/3/issue/KPA-96/comment` returns no `parentId` on its ruling
 * comment, on the same one-question shape. So the link is not always written,
 * and reading it would need a second call per issue besides: the
 * `/rest/api/3/search/jql` endpoint this script actually calls, with
 * `fields: ['comment']`, answers `id` and `created` on each comment and drops
 * `parentId` entirely, checked the same day against the same two tickets.
 *
 * A ticket with exactly one open question is therefore the only case this can
 * pair honestly, and it is also every ticket in the project's history but
 * one. With two or more open questions, a ruling cannot be matched to either
 * one, so it is recorded on a row of its own that says so, and every open
 * question is left open rather than closed by a guess.
 *
 * A ruling comment can name its question instead: it restates the question
 * verbatim in its own `DECISION NEEDED` panel, then carries the decision
 * block. A comment's question is read before its decision items, so when its
 * text matches an open entry on the same ticket, that entry is the ruling's
 * target, whatever else is open. Matching looks only at open entries, so a
 * restatement of an already-decided question cannot touch the recorded
 * ruling; it opens a fresh entry instead, as a reopened question would.
 */
export function entriesForIssue(issue: { key: string; status: string; comments: Comment[] }): Entry[] {
  const entries: Entry[] = [];
  const open = () => entries.filter((entry) => entry.ruling === null);

  for (const comment of issue.comments) {
    const question = questionIn(comment.body);
    const recommended = recommendationIn(comment.body);
    let target: Entry | null = null;

    if (question !== null) {
      target = open().find((entry) => entry.question === question) ?? null;
      if (target) {
        if (recommended !== null) target.recommended = recommended;
      } else {
        target = {
          key: issue.key,
          status: issue.status,
          question,
          recommended: recommended ?? '',
          ruling: null,
          on: null,
        };
        entries.push(target);
      }
    } else if (recommended !== null) {
      const openEntries = open();
      // Two open questions: which one this recommendation updates is the same
      // unknown as which one a ruling answers, so leave both as first posted.
      if (openEntries.length === 1 && openEntries[0]) openEntries[0].recommended = recommended;
    }

    for (const item of collect(comment.body, 'decisionItem')) {
      if (item.attrs?.['state'] !== 'DECIDED') continue;
      const ruling = flatten(item).trim();
      const on = comment.created.slice(0, 10);

      // This comment named its own question: the ruling pairs with it
      // directly, regardless of what else is open on the ticket.
      if (target) {
        target.ruling = ruling;
        target.on = on;
        continue;
      }

      const openEntries = open();

      if (openEntries.length === 1 && openEntries[0]) {
        openEntries[0].ruling = ruling;
        openEntries[0].on = on;
      } else if (openEntries.length === 0) {
        // A ruling with no open question on this ticket at all. Keep the old
        // fallback rather than drop the ruling on the floor.
        entries.push({
          key: issue.key,
          status: issue.status,
          question: '(the question is not in a warning panel)',
          recommended: '',
          ruling,
          on,
        });
      } else {
        // Two or more open questions: do not guess which one this answers.
        entries.push({
          key: issue.key,
          status: issue.status,
          question: '(this ticket has more than one open question; which one this ruling answers is not recorded)',
          recommended: '',
          ruling,
          on,
        });
      }
    }
  }

  return entries;
}
