import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entriesForIssue, type Node } from '../scripts/decision-entries.ts';

/** A `DECISION NEEDED` warning panel, built the shape `questionIn` reads. */
function questionComment(question: string, recommendation: string, created: string) {
  return {
    created,
    body: {
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'warning' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'DECISION NEEDED' }] },
            { type: 'paragraph', content: [{ type: 'text', text: question }] },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `MY RECOMMENDATION: ${recommendation}.` }],
        },
      ] as Node[],
    },
  };
}

/** A Jira decision block carrying one decided ruling. */
function rulingComment(ruling: string, created: string) {
  return {
    created,
    body: {
      type: 'doc',
      content: [
        {
          type: 'decisionList',
          content: [
            {
              type: 'decisionItem',
              attrs: { state: 'DECIDED' },
              content: [{ type: 'text', text: ruling }],
            },
          ],
        },
      ] as Node[],
    },
  };
}

/** A real Shane ruling: it restates its question in a panel, then decides it. */
function restatedRulingComment(question: string, ruling: string, created: string) {
  return {
    created,
    body: {
      type: 'doc',
      content: [
        {
          type: 'panel',
          attrs: { panelType: 'warning' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'DECISION NEEDED' }] },
            { type: 'paragraph', content: [{ type: 'text', text: question }] },
          ],
        },
        {
          type: 'decisionList',
          content: [
            {
              type: 'decisionItem',
              attrs: { state: 'DECIDED' },
              content: [{ type: 'text', text: ruling }],
            },
          ],
        },
      ] as Node[],
    },
  };
}

test('one question reads as one entry, waiting', () => {
  const entries = entriesForIssue({
    key: 'KPA-1',
    status: 'Decision required',
    comments: [questionComment('Does X happen?', 'option A', '2026-09-01T00:00:00.000+1000')],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.question, 'Does X happen?');
  assert.equal(entries[0]?.recommended, 'option A');
  assert.equal(entries[0]?.ruling, null);
});

test('a question followed by its ruling reads as one entry, decided', () => {
  const entries = entriesForIssue({
    key: 'KPA-1',
    status: 'Done',
    comments: [
      questionComment('Does X happen?', 'option A', '2026-09-01T00:00:00.000+1000'),
      rulingComment('option A', '2026-09-02T00:00:00.000+1000'),
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.question, 'Does X happen?');
  assert.equal(entries[0]?.ruling, 'option A');
  assert.equal(entries[0]?.on, '2026-09-02');
});

test('two questions on one ticket read as two entries, each with its own recommendation', () => {
  const entries = entriesForIssue({
    key: 'KPA-108',
    status: 'In Progress',
    comments: [
      questionComment('Does needs_you gain a fifth kind?', 'option A', '2026-10-01T12:28:40.187+1000'),
      questionComment('How many days before expiry?', 'option B, 14 days', '2026-10-01T12:28:40.555+1000'),
    ],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.question, 'Does needs_you gain a fifth kind?');
  assert.equal(entries[0]?.recommended, 'option A');
  assert.equal(entries[0]?.ruling, null);
  assert.equal(entries[1]?.question, 'How many days before expiry?');
  assert.equal(entries[1]?.recommended, 'option B, 14 days');
  assert.equal(entries[1]?.ruling, null);
});

test('a ruling on a two-question ticket answers neither question, and both stay waiting', () => {
  const entries = entriesForIssue({
    key: 'KPA-108',
    status: 'In Progress',
    comments: [
      questionComment('Does needs_you gain a fifth kind?', 'option A', '2026-10-01T12:28:40.187+1000'),
      questionComment('How many days before expiry?', 'option B, 14 days', '2026-10-01T12:28:40.555+1000'),
      rulingComment('option A', '2026-10-02T00:00:00.000+1000'),
    ],
  });

  // The ruling cannot be told from the two open questions, so it lands on a
  // row of its own and neither question is marked decided.
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.question, 'Does needs_you gain a fifth kind?');
  assert.equal(entries[0]?.ruling, null);
  assert.equal(entries[1]?.question, 'How many days before expiry?');
  assert.equal(entries[1]?.ruling, null);
  assert.equal(entries[2]?.ruling, 'option A');
  assert.notEqual(entries[2]?.question, 'Does needs_you gain a fifth kind?');
  assert.notEqual(entries[2]?.question, 'How many days before expiry?');
});

test('KPA-165: a ruling that restates its own question pairs with it, whatever else is open', () => {
  const entries = entriesForIssue({
    key: 'KPA-108',
    status: 'Done',
    comments: [
      questionComment('Does needs_you gain a fifth kind?', 'option A', '2026-10-01T12:28:40.187+1000'),
      questionComment('How many days before expiry?', 'option B, 14 days', '2026-10-01T12:28:40.555+1000'),
      restatedRulingComment('Does needs_you gain a fifth kind?', 'option A', '2026-10-01T13:00:00.000+1000'),
      restatedRulingComment('How many days before expiry?', 'option B, 14 days', '2026-10-01T13:05:00.000+1000'),
    ],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.question, 'Does needs_you gain a fifth kind?');
  assert.equal(entries[0]?.ruling, 'option A');
  assert.equal(entries[1]?.question, 'How many days before expiry?');
  assert.equal(entries[1]?.ruling, 'option B, 14 days');
});

test('KPA-165: restating an already-decided question opens a fresh entry rather than overwrite the ruling', () => {
  const entries = entriesForIssue({
    key: 'KPA-1',
    status: 'Done',
    comments: [
      questionComment('Does X happen?', 'option A', '2026-09-01T00:00:00.000+1000'),
      restatedRulingComment('Does X happen?', 'option A', '2026-09-02T00:00:00.000+1000'),
      restatedRulingComment('Does X happen?', 'option B', '2026-09-03T00:00:00.000+1000'),
    ],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.question, 'Does X happen?');
  assert.equal(entries[0]?.ruling, 'option A');
  assert.equal(entries[1]?.question, 'Does X happen?');
  assert.equal(entries[1]?.ruling, 'option B');
});
