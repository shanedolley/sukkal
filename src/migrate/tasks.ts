/**
 * Turns a note's body into the tasks written on it.
 *
 * A task is an inline `- [ ]` in the note it belongs to, never a standalone
 * list, so this reads one note's body and nothing else -- it does not walk
 * the vault, and it does not know which fact the body came from. Attaching a
 * result to a fact is the caller's job, once the fact has an id to attach to.
 *
 * `raw_line` is the line the loop already has, off `body.split('\n')`,
 * rather than a line rebuilt from the pieces below it: a reconstruction
 * guesses at glyph, signifier order and whitespace, and a straight copy
 * cannot get any of that wrong.
 *
 * Only a top-level `- [ ]` matches. The frozen vault has no indented task, so
 * handling one would be a guess at a shape nothing here has seen.
 */

export interface ParsedTask {
  rawLine: string;
  text: string;
  due: string | null;
  start: string | null;
  done: string | null;
}

const TASK_LINE = /^- \[[ xX]\] ?(.*)$/;

// The Tasks plugin's three signifiers. The vault's own CLAUDE.md requires
// every date `YYYY-MM-DD`, so the pattern below assumes nothing looser.
const DUE_SIGNIFIER = / 📅 (\d{4}-\d{2}-\d{2})/u;
const START_SIGNIFIER = / 🛫 (\d{4}-\d{2}-\d{2})/u;
const DONE_SIGNIFIER = / ✅ (\d{4}-\d{2}-\d{2})/u;

/** Reads one signifier's date out of `text` and removes it, or leaves `text`
 *  untouched when the signifier is absent. Absence returns null rather than
 *  an invented date -- a task with no established deadline stays undated. */
function readSignifier(text: string, signifier: RegExp): [string, string | null] {
  const match = signifier.exec(text);
  return match ? [text.replace(signifier, ''), match[1]!] : [text, null];
}

/** Every inline task in `body`, in the order it appears. A future start date
 *  is returned like any other -- hiding it until then is a query's job, and
 *  this slice ships no query, so nothing here filters. */
export function parseTasks(body: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];

  for (const line of body.split('\n')) {
    const match = TASK_LINE.exec(line);
    if (!match) {
      continue;
    }

    let text = match[1]!;
    let due: string | null;
    let start: string | null;
    let done: string | null;
    [text, due] = readSignifier(text, DUE_SIGNIFIER);
    [text, start] = readSignifier(text, START_SIGNIFIER);
    [text, done] = readSignifier(text, DONE_SIGNIFIER);

    tasks.push({ rawLine: line, text: text.trim(), due, start, done });
  }

  return tasks;
}
