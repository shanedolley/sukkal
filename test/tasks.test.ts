import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseTasks } from '../src/migrate/tasks.ts';
import { vaultPath } from '../src/vault-mapping.ts';

// The vault lives on Shane's Mac and nowhere else, so every suite that reads
// it skips where it is absent. Without this the four tests below fail in CI,
// which is where they failed on 2 September 2026.
const vaultReason = existsSync(vaultPath()) ? false : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('parseTasks', () => {
  test('a plain task carries no dates', () => {
    const [task] = parseTasks('- [ ] Buy milk');
    assert.deepEqual(task, { rawLine: '- [ ] Buy milk', text: 'Buy milk', due: null, start: null, done: null });
  });

  test('an empty checkbox has empty text rather than a guess', () => {
    const [task] = parseTasks('- [ ]');
    assert.equal(task?.text, '');
  });

  test('reads the due signifier and strips it from text', () => {
    const [task] = parseTasks('- [ ] Renew passport 📅 2026-10-01');
    assert.equal(task?.text, 'Renew passport');
    assert.equal(task?.due, '2026-10-01');
    assert.equal(task?.start, null);
    assert.equal(task?.done, null);
  });

  test('reads the start signifier and strips it from text', () => {
    const [task] = parseTasks('- [ ] Draft the proposal 🛫 2026-09-15');
    assert.equal(task?.text, 'Draft the proposal');
    assert.equal(task?.start, '2026-09-15');
    assert.equal(task?.due, null);
  });

  test('a completed task reads the done signifier and strips it from text', () => {
    const [task] = parseTasks('- [x] Send the invoice ✅ 2026-08-30');
    assert.equal(task?.text, 'Send the invoice');
    assert.equal(task?.done, '2026-08-30');
  });

  test('a task with all three signifiers reads all three, in whatever order they were written', () => {
    const [task] = parseTasks('- [x] Ship the release 🛫 2026-09-01 📅 2026-09-10 ✅ 2026-09-09');
    assert.equal(task?.text, 'Ship the release');
    assert.equal(task?.start, '2026-09-01');
    assert.equal(task?.due, '2026-09-10');
    assert.equal(task?.done, '2026-09-09');
  });

  test('a deferred task with a start date in the future is still returned, undropped', () => {
    // Hiding it until the start date is a query's job -- ADR-revised PRD:
    // this slice ships no query, so this layer must not filter it out.
    const [task] = parseTasks('- [ ] Plan the offsite 🛫 2099-01-01');
    assert.equal(task?.start, '2099-01-01');
  });

  test('ignores prose that is not a checkbox', () => {
    assert.deepEqual(parseTasks('Just a sentence.\n- [ ] A real task\nMore prose.'), [
      { rawLine: '- [ ] A real task', text: 'A real task', due: null, start: null, done: null },
    ]);
  });

  test('reads every task in a body, in order', () => {
    const tasks = parseTasks('- [ ] First\nSome prose in between.\n- [x] Second ✅ 2026-01-01');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]?.text, 'First');
    assert.equal(tasks[1]?.text, 'Second');
  });
});

describe('parseTasks, against the frozen vault', { skip: vaultReason }, () => {
  const VAULT = vaultPath();

  /** The exact bytes of the line starting with `needle`, up to but not
   *  including its newline -- read off the file's own bytes, not through any
   *  string operation this test is trying to prove correct. */
  function lineBytes(file: string, needle: string): Buffer {
    const buffer = readFileSync(path.join(VAULT, file));
    const start = buffer.indexOf(needle, 0, 'utf8');
    assert.notEqual(start, -1, `${file}: no line starts with ${JSON.stringify(needle)}`);
    const end = buffer.indexOf(0x0a, start);
    return buffer.subarray(start, end === -1 ? buffer.length : end);
  }

  // Real lines from the frozen vault (commit da7afce), one per signifier, so
  // the round trip is proved against what the Tasks plugin actually wrote --
  // not a line this test typed out by hand.
  const cases: Array<{ file: string; needle: string }> = [
    { file: 'koinon/koinon-engineering-entity.md', needle: "- [ ] Assess Dolche's R&D tax credit potential" },
    { file: 'koinon/marinucci-data-warehouse-proposal.md', needle: '- [x] Chase David Marinucci' },
    { file: 'collibra/sow-nexus-q47405.md', needle: '- [ ] Record on this note whether' },
  ];

  for (const { file, needle } of cases) {
    test(`round-trips ${file}'s task byte-for-byte`, () => {
      const body = readFileSync(path.join(VAULT, file), 'utf8');
      const task = parseTasks(body).find((candidate) => candidate.rawLine.startsWith(needle));
      assert.ok(task, `${file}: parseTasks found no task starting with ${JSON.stringify(needle)}`);

      const expected = lineBytes(file, needle);
      const actual = Buffer.from(task.rawLine, 'utf8');
      assert.ok(
        actual.equals(expected),
        `${file}: raw_line did not round-trip byte-for-byte\n  expected: ${expected.toString('hex')}\n  actual:   ${actual.toString('hex')}`,
      );
    });
  }

  /** Every `.md` file under `dir`. A local walker rather than a call into
   *  `read-vault.ts`, whose reader is under active edit by another agent in
   *  this same tree this test must not couple itself to. */
  function markdownFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(path.join(entry.parentPath, entry.name));
      }
    }
    return found;
  }

  test('every inline task in every space note round-trips byte-for-byte, none dropped', () => {
    // sources/ notes have real checkboxes too (templates, follow-up lists),
    // but they attach to no fact and are out of scope for this table.
    const spaces = ['collibra', 'koinon', 'personal', 'shared'];
    let checked = 0;

    for (const space of spaces) {
      for (const absolute of markdownFiles(path.join(VAULT, space))) {
        const buffer = readFileSync(absolute);
        const body = buffer.toString('utf8');

        // The expected lines, read straight off the file's own bytes -- the
        // same check parseTasks makes, applied independently of it.
        const expectedLines: Buffer[] = [];
        let lineStart = 0;
        for (let i = 0; i <= buffer.length; i += 1) {
          if (i === buffer.length || buffer[i] === 0x0a) {
            const line = buffer.subarray(lineStart, i);
            if (/^- \[[ xX]\]/u.test(line.toString('utf8'))) {
              expectedLines.push(line);
            }
            lineStart = i + 1;
          }
        }

        const tasks = parseTasks(body);
        const relative = path.relative(VAULT, absolute);
        assert.equal(tasks.length, expectedLines.length, `${relative}: task count mismatch`);

        for (const [index, expectedLine] of expectedLines.entries()) {
          const actual = Buffer.from(tasks[index]!.rawLine, 'utf8');
          assert.ok(actual.equals(expectedLine), `${relative}: task ${index} did not round-trip byte-for-byte`);
        }

        checked += tasks.length;
      }
    }

    assert.ok(checked > 0, 'expected at least one inline task somewhere under the four spaces');
  });
});
