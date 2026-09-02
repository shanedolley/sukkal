/**
 * The six problems the vault's `scripts/check.py` fails the run on, ported
 * so KPA-13 can diff this side's report against that one.
 *
 * Every message string below is copied character for character from
 * `check.py`, including its quirks: a missing `type:` or `status:` key
 * reports as the literal word `None`, because that is what Python's
 * `fields.get(key)` renders inside the f-string, and the type and status
 * lists print in Python's `sorted(list)` repr, single-quoted. A future
 * rewording on either side is meant to show up as a diff, not disappear
 * into it.
 *
 * `check.py` also fails a note with no frontmatter, a missing required
 * field, a folder that disagrees with its `space:`, and a date that is not
 * `YYYY-MM-DD`. Those four are not among the six this story names, and
 * `src/migrate/schema.ts` already covers them for the fields the database
 * schema constrains. This file adds only what schema.ts does not check:
 * the space ceiling, the description length, `verified` without
 * `verified_by`, and a wikilink with no note. `type` and `status` are
 * repeated here too, because `check.py` runs them against the vault's own
 * vocabulary independently of whether the rest of the note is well-formed,
 * and a note schema.ts rejects for an unrelated reason must still be
 * checked for these six.
 *
 * `type` reuses `FACT_TYPES` and `status` reuses `VAULT_STATUSES` from
 * `src/migrate/schema.ts` rather than repeating either list: ADR-0010 and
 * ADR-0011 are why `status` checks against the vault's vocabulary and not
 * the database's, and schema.ts is where that decision already lives.
 *
 * A wikilink is checked against every note in a space, every root-level
 * page (`index`, `log`, `CLAUDE`, `README`), and everything under
 * `sources/`, matching `check.py`'s own `link_targets`. This is wider than
 * `src/migrate/edges.ts`'s `resolveTarget`, which resolves against facts
 * and sources only, because the node registry has no kind for a root page.
 * The frozen vault cites `[[index]]` nine times; `edges.ts` reads those as
 * unresolved, and this file reads them as fine, because that is what
 * `check.py` does.
 *
 * That difference costs this report nothing. Both sides find zero broken
 * links in the frozen vault, so the nine never reach a line here.
 * `docs/adr/0019-a-root-page-is-not-a-node.md` settled it and put the whole
 * drift in `src/checks/advisories.ts`, at two orphan lines.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FACT_TYPES, VAULT_STATUSES } from '../migrate/schema.ts';
import { vaultPath } from '../vault-mapping.ts';

const SPACE_LIMIT = 120;
const DESCRIPTION_LIMIT = 200;
const LINK = /\[\[([^\]|#]+)/g;

/**
 * `check.py`'s own `SPACES` order: shared, collibra, koinon, personal.
 * Kept literal and separate from `vault-mapping.ts`'s `SPACES`, which lists
 * the same four names alphabetically for unrelated reasons -- this order is
 * the one the ceiling problems print in, and the diff compares text.
 */
const SPACE_ORDER = ['shared', 'collibra', 'koinon', 'personal'] as const;

const TYPES_SORTED = [...FACT_TYPES].sort();
const STATUSES_SORTED = [...VAULT_STATUSES].sort();

/** Python's `repr(sorted(a_set_of_str))`: single-quoted, comma-space joined. */
function pyList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}

/** Every `.md` file directly inside `dir`, non-recursive, or none when `dir`
 *  does not exist -- matching `Path.glob("*.md")`, which does not descend. */
async function listMarkdown(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => path.join(dir, entry.name));
}

/** Every `.md` file under `dir`, at any depth, matching `Path.rglob("*.md")`. */
async function rglobMarkdown(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** A file's basename with `.md` removed, matching how a wikilink names its target. */
function stem(file: string): string {
  return path.basename(file, '.md');
}

/** Every note in a space, across all four spaces, sorted by path -- matching
 *  `check.py`'s `sorted(f for space in SPACES for f in ...)`, which sorts the
 *  combined list rather than grouping by space. */
async function notes(vault: string): Promise<string[]> {
  const found: string[] = [];
  for (const space of SPACE_ORDER) {
    found.push(...(await listMarkdown(path.join(vault, space))));
  }
  return found.sort();
}

/** Everything a `[[link]]` may legitimately point at: every note in a space,
 *  the vault's root-level pages, and everything under `sources/`. */
async function linkTargets(vault: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const file of await notes(vault)) {
    names.add(stem(file));
  }
  for (const file of await listMarkdown(vault)) {
    names.add(stem(file));
  }
  for (const file of await rglobMarkdown(path.join(vault, 'sources'))) {
    names.add(stem(file));
  }
  return names;
}

/**
 * Reads a note's top-level `key: value` frontmatter, exactly as `check.py`
 * does: no quote-unescaping, no list parsing, and a nested or list-valued
 * line is ignored. `src/migrate/read-vault.ts`'s `parseNote` does more than
 * this on purpose, which is why this file does not reuse it -- a value
 * check.py reads with its quotes still on must not read differently here.
 */
function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---\n')) {
    return {};
  }
  const splitAt = text.indexOf('\n---');
  const head = (splitAt === -1 ? text : text.slice(0, splitAt)).slice(4);
  const fields: Record<string, string> = {};
  for (const line of head.split(/\r\n|\r|\n/)) {
    if (line.includes(': ') && !/^[ \t-]/.test(line)) {
      const separator = line.indexOf(': ');
      const key = line.slice(0, separator).trim();
      fields[key] = line.slice(separator + 2).trim();
    }
  }
  return fields;
}

/**
 * The six problems in `vault`, worded to match `scripts/check.py`
 * character for character. A non-empty result is `check.py`'s non-zero
 * exit: any problem here fails the run, and none is an advisory.
 */
export async function problems(vault: string = vaultPath()): Promise<string[]> {
  const found: string[] = [];

  for (const space of SPACE_ORDER) {
    const count = (await listMarkdown(path.join(vault, space))).length;
    if (count > SPACE_LIMIT) {
      found.push(
        `${space}/: ${count} notes, over the ${SPACE_LIMIT} ceiling. ` +
          'Merge or retire before adding more, or raise the ceiling deliberately.',
      );
    }
  }

  const files = await notes(vault);
  const names = await linkTargets(vault);

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const where = `${path.basename(path.dirname(file))}/${path.basename(file)}`;
    const fields = frontmatter(text);

    if (Object.keys(fields).length === 0) {
      // "no frontmatter" is not one of the six; check.py reports it and
      // moves to the next file without running the rest of its checks, so
      // this file does the same and reports nothing for this one.
      continue;
    }

    const type = fields['type'];
    if (type === undefined || !(TYPES_SORTED as readonly string[]).includes(type)) {
      found.push(`${where}: type \`${type ?? 'None'}\` is not one of ${pyList(TYPES_SORTED)}`);
    }

    const status = fields['status'];
    if (status === undefined || !(STATUSES_SORTED as readonly string[]).includes(status)) {
      found.push(`${where}: status \`${status ?? 'None'}\` is not one of ${pyList(STATUSES_SORTED)}`);
    }

    if ((fields['description'] ?? '').length > DESCRIPTION_LIMIT) {
      found.push(`${where}: description over ${DESCRIPTION_LIMIT} characters; it is the index, keep it scannable`);
    }

    if ('verified' in fields && !('verified_by' in fields)) {
      found.push(`${where}: verified without verified_by; who confirmed it?`);
    }

    for (const match of text.matchAll(LINK)) {
      const target = match[1]!.trim();
      if (!names.has(target)) {
        found.push(`${where}: [[${target}]] has no note`);
      }
    }
  }

  return found;
}
