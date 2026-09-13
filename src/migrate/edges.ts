/**
 * Turns a note's body and frontmatter into the edges it names.
 *
 * Two kinds of edge and nothing else, per `docs/schema.md`'s `edge_kind`:
 * a `[[wikilink]]` in the body becomes `links_to`, and a `sources:` entry
 * becomes `derived_from`. `supersedes` is not made here -- it comes from a
 * replacement retiring a fact, not from a link in a note.
 *
 * This file only extracts and resolves. It opens no connection and inserts
 * no row: `docs/adr/0007-a-node-registry-for-edges.md` requires a node and
 * its child row in one transaction, and only a caller holding that
 * transaction can decide when to write. What each function here returns is
 * everything that caller needs to do so.
 */
import path from 'node:path';
import type { FactNote, ParsedNote, SourceNote } from './read-vault.ts';

export type EdgeKind = 'links_to' | 'derived_from';

/**
 * Where one candidate edge points, before it is checked against the vault.
 *
 * A `wikilink` still carries the raw `[[name]]` text. Deciding whether that
 * name is a fact, a source, or nothing is `resolveTarget`'s job, not this
 * shape's.
 */
export type RawTarget =
  | { form: 'wikilink'; name: string }
  | { form: 'url'; url: string }
  | { form: 'text'; text: string };

export interface EdgeCandidate {
  kind: EdgeKind;
  target: RawTarget;
  /** The `sources:` entry a `derived_from` candidate came from, verbatim, or
   *  null on a `links_to`. KPA-131: the target alone loses the author, the
   *  place and the date the entry stated. */
  citation: string | null;
}

/**
 * Where a candidate resolved to, once checked against the vault.
 *
 * `fact` and `source` name the row's `path`, which is what a caller looks
 * up (or creates) a node for. `url` and `unresolved` carry the value
 * `nodes.ref` holds for those two kinds, per the registry.
 */
export type ResolvedTarget =
  | { kind: 'fact'; path: string }
  | { kind: 'source'; path: string }
  | { kind: 'url'; ref: string }
  | { kind: 'unresolved'; ref: string };

export interface ResolvedEdge {
  kind: EdgeKind;
  target: ResolvedTarget;
  citation: string | null;
}

/**
 * The text inside `[[ ]]`, up to an alias (`|`) or an anchor (`#`), trimmed.
 *
 * Matches the vault's own `scripts/check.py` exactly, so the two reports
 * name the same link the same way. The frozen vault uses neither an alias
 * nor an anchor, but a fixture or a future note might.
 */
const WIKILINK_GLOBAL = /\[\[([^\]|#]+)/g;
const WIKILINK_FIRST = /\[\[([^\]|#]+)/;
const URL = /https?:\/\/\S+/;

/**
 * Every unique `[[wikilink]]` in `body`, as `links_to` candidates.
 *
 * A note linking the same target twice names one relationship, not two,
 * which is also how `scripts/check.py` reads a note's links: as a set.
 */
function linksToCandidates(body: string): EdgeCandidate[] {
  const seen = new Set<string>();
  const candidates: EdgeCandidate[] = [];
  for (const match of body.matchAll(WIKILINK_GLOBAL)) {
    const name = match[1]!.trim();
    if (!seen.has(name)) {
      seen.add(name);
      candidates.push({ kind: 'links_to', target: { form: 'wikilink', name }, citation: null });
    }
  }
  return candidates;
}

/**
 * The target one `sources:` entry names.
 *
 * A wikilink inside the entry wins: most entries are a citation in prose
 * with a `[[note]]` naming what it came from. Failing that, a URL. Failing
 * that, the entry names nothing machine-readable, so its raw text becomes
 * the target -- unconditionally producing an edge is the acceptance
 * criterion, and dropping a citation because it is prose would fail it.
 *
 * A winning wikilink drops the words around it from the target, and only
 * from the target. KPA-131 keeps the whole entry as the candidate's
 * `citation`, so "Shane, answers in [[index]], 23 August 2026" still points
 * at `index` and still says who and when.
 */
function targetOf(entry: string): RawTarget {
  const link = WIKILINK_FIRST.exec(entry);
  if (link) {
    return { form: 'wikilink', name: link[1]!.trim() };
  }
  const url = URL.exec(entry);
  if (url) {
    return { form: 'url', url: url[0] };
  }
  return { form: 'text', text: entry.trim() };
}

/**
 * One `derived_from` candidate per `sources:` entry, in entry order.
 *
 * A scalar value counts as one entry. An absent `sources:` produces no
 * candidates rather than throwing: `schema.ts` already rejects a fact note
 * missing the field, so a note reaching here without it is a `sources/`
 * note or a caller working outside that validation, not a fact skipped.
 */
function derivedFromCandidates(frontmatter: ParsedNote['frontmatter']): EdgeCandidate[] {
  const raw = frontmatter['sources'];
  if (raw === undefined) {
    return [];
  }
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries
    .filter((entry) => entry !== '')
    .map((entry) => ({ kind: 'derived_from' as const, target: targetOf(entry), citation: entry }));
}

/** Every candidate edge one note names: `links_to` from its body, then
 *  `derived_from` from its `sources:` list. */
export function edgeCandidates(note: Pick<ParsedNote, 'frontmatter' | 'body'>): EdgeCandidate[] {
  return [...linksToCandidates(note.body), ...derivedFromCandidates(note.frontmatter)];
}

/** A file's basename with any `.md` extension removed, matching how a
 *  wikilink names its target. */
function basename(file: string): string {
  return path.basename(file, '.md');
}

export interface KnownTargets {
  /** Basename to `facts.path`. */
  facts: ReadonlyMap<string, string>;
  /** Basename to `sources.path`. */
  sources: ReadonlyMap<string, string>;
}

/**
 * Indexes what `readVault` found, once, so `resolveTarget` can look a
 * wikilink up rather than scan the vault for every one.
 *
 * A wikilink resolves by filename across the whole vault -- `docs/schema.md`
 * says so, and `scripts/check.py` already worked that way. Two notes
 * sharing a basename would collide here, one silently shadowing the other;
 * the frozen vault has none, and nothing enforces the uniqueness the
 * convention assumes.
 */
export function knownTargets(
  facts: readonly Pick<FactNote, 'file'>[],
  sources: readonly Pick<SourceNote, 'file'>[],
): KnownTargets {
  const factMap = new Map<string, string>();
  for (const fact of facts) {
    factMap.set(basename(fact.file), fact.file);
  }
  const sourceMap = new Map<string, string>();
  for (const source of sources) {
    sourceMap.set(basename(source.file), source.file);
  }
  return { facts: factMap, sources: sourceMap };
}

/**
 * Resolves one candidate's target against the vault `known` indexes.
 *
 * A wikilink naming a fact or a source resolves to that row's path. A
 * wikilink naming anything else becomes `unresolved`, holding the raw
 * `[[name]]` text -- ADR-0007's broken link that costs a row rather than
 * being dropped. A URL becomes a `url` target. Prose with neither becomes
 * `unresolved` too, holding the whole entry: the registry has no sixth kind
 * for "cited, but not a link", and a citation kept as text is still a
 * citation kept, rather than one silently dropped.
 *
 * `scripts/check.py` also treats every note in a space, every note under
 * `sources/`, and the vault's four root pages (`index`, `log`, `CLAUDE`,
 * `README`) as a valid target. This resolves against facts and sources
 * only, because those are the two kinds a wikilink can become in the
 * registry -- a root page is ingested as neither, so it has no row to
 * point at. `docs/adr/0019-a-root-page-is-not-a-node.md` decided that and
 * says why: a root page belongs to none of the memory's three layers.
 *
 * The frozen vault cites `[[index]]` nine times and nothing else outside a
 * space or `sources/`, so those nine resolve `unresolved` here though
 * `check.py` counts zero broken links. **The nine cost the two reports no
 * line.** `src/checks/problems.ts` runs `check.py`'s own link rule, root
 * pages included, and both sides report zero broken links. The real drift
 * runs the other way, from a root page's outbound links, and ADR-0019
 * measures it at two orphan advisories.
 */
export function resolveTarget(target: RawTarget, known: KnownTargets): ResolvedTarget {
  switch (target.form) {
    case 'wikilink': {
      const factPath = known.facts.get(target.name);
      if (factPath !== undefined) {
        return { kind: 'fact', path: factPath };
      }
      const sourcePath = known.sources.get(target.name);
      if (sourcePath !== undefined) {
        return { kind: 'source', path: sourcePath };
      }
      return { kind: 'unresolved', ref: target.name };
    }
    case 'url':
      return { kind: 'url', ref: target.url };
    case 'text':
      return { kind: 'unresolved', ref: target.text };
  }
}

/**
 * Every edge one note names, resolved against `known`.
 *
 * The one function most callers need: `edgeCandidates` and `resolveTarget`
 * stay exported separately because a caller checking only what a note
 * links to, without a vault to resolve against, needs the first and not
 * the second.
 */
export function edgesFor(
  note: Pick<ParsedNote, 'frontmatter' | 'body'>,
  known: KnownTargets,
): ResolvedEdge[] {
  return edgeCandidates(note).map((candidate) => ({
    kind: candidate.kind,
    target: resolveTarget(candidate.target, known),
    citation: candidate.citation,
  }));
}
