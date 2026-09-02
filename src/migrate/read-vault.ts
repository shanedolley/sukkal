/**
 * Reads every note in the vault and validates it before anything is written.
 *
 * A note that parses subtly wrong enters the database as a fact and gets
 * read as true for months, so the rule here is the same one `gates.ts`
 * follows: silence is the failure mode to design against, and the default
 * is to fail loudly and name the file, the field and the reason.
 *
 * A note in a space is validated against `schema.ts`. A note under
 * `sources/` is read verbatim and never validated: `docs/schema.md` says
 * why -- it stores in `sources.body` with whatever frontmatter it arrived
 * with, including none, so it has no schema to fit.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SPACES, vaultPath } from '../vault-mapping.ts';
import { STATUS_TO_STATE, validateFrontmatter, type FactState, type Failure, type VaultStatus } from './schema.ts';

export type Frontmatter = Readonly<Record<string, string | string[]>>;

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

export interface FactNote {
  file: string;
  space: (typeof SPACES)[number];
  frontmatter: Frontmatter;
  /** The vault's `status`, translated by ADR-0011. */
  state: FactState;
  body: string;
}

export interface SourceNote {
  file: string;
  frontmatter: Frontmatter;
  body: string;
}

export interface FileFailure {
  file: string;
  failures: Failure[];
}

export interface VaultReport {
  filesRead: number;
  filesValid: number;
  filesFailed: number;
  facts: FactNote[];
  sources: SourceNote[];
  failures: FileFailure[];
}

/** Unwraps one double- or single-quoted scalar. Escaped double quotes
 *  (`\"`) unescape; a single-quoted value has none to unescape, because the
 *  vault never writes one. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

/** Splits a flow sequence's inner text on its top-level commas, so a
 *  quoted item that contains its own comma (`"Shane, 25 August 2026"`)
 *  survives as one item rather than two. */
function splitFlowSequence(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if (char === '"' && inner[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      items.push(unquote(current.trim()));
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') {
    items.push(unquote(current.trim()));
  }
  return items;
}

/** Reads one frontmatter value: a flow sequence (`[a, b]`) becomes an
 *  array, everything else a scalar. The vault writes neither block scalars
 *  nor multi-line values, so a line each is all this needs to cover. */
function parseValue(raw: string): string | string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitFlowSequence(trimmed.slice(1, -1));
  }
  return unquote(trimmed);
}

const FRONTMATTER_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/;

/** Splits one note's text into its frontmatter and body. A note with no
 *  `---` block, or an unterminated one, has empty frontmatter and its whole
 *  text as body -- `sources/` material Obsidian never required to carry
 *  either. */
export function parseNote(text: string): ParsedNote {
  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }

  const frontmatter: Record<string, string | string[]> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = FRONTMATTER_KEY.exec(line);
    if (match) {
      frontmatter[match[1]!] = parseValue(match[2] ?? '');
    }
  }

  return { frontmatter, body: text.slice(end + 4).replace(/^\r?\n/, '') };
}

/** Every `.md` file under `dir`, or none when `dir` does not exist -- a
 *  space the frozen vault has not populated is not a file this run skipped. */
async function markdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
}

/** Reads and validates every note in `root`, defaulting to the vault
 *  `vaultPath()` names. Every `.md` file under a space or under `sources/`
 *  is counted: read, valid or failed, and never silently skipped. */
export async function readVault(root: string = vaultPath()): Promise<VaultReport> {
  const report: VaultReport = {
    filesRead: 0,
    filesValid: 0,
    filesFailed: 0,
    facts: [],
    sources: [],
    failures: [],
  };

  for (const space of SPACES) {
    for (const absolute of await markdownFiles(path.join(root, space))) {
      const file = path.relative(root, absolute);
      const { frontmatter, body } = parseNote(await readFile(absolute, 'utf8'));
      report.filesRead += 1;

      const failures = validateFrontmatter(frontmatter);
      if (failures.length > 0) {
        report.filesFailed += 1;
        report.failures.push({ file, failures });
        continue;
      }

      report.filesValid += 1;
      const state = STATUS_TO_STATE[frontmatter['status'] as VaultStatus];
      report.facts.push({ file, space, frontmatter, state, body });
    }
  }

  for (const absolute of await markdownFiles(path.join(root, 'sources'))) {
    const file = path.relative(root, absolute);
    const { frontmatter, body } = parseNote(await readFile(absolute, 'utf8'));
    report.filesRead += 1;
    report.filesValid += 1;
    report.sources.push({ file, frontmatter, body });
  }

  return report;
}
