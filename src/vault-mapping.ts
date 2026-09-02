/**
 * Where each of the vault's frontmatter fields lands in the schema.
 *
 * The vault's own `CLAUDE.md` is the authority. This file is the claim that
 * every field it defines has somewhere to go, and `test/schema.test.ts` fails
 * on any key the vault carries and this table does not.
 *
 * A key appearing here for the first time is a schema gap found before
 * ingestion rather than after, which is the whole reason the mapping is
 * checked rather than assumed.
 */

/** The four directories holding facts. `sources/` is not one of them. */
export const SPACES = ['collibra', 'koinon', 'personal', 'shared'] as const;

/**
 * Every field a note in a space may carry.
 *
 * Notes under `sources/` are excluded on purpose. They store verbatim in
 * `sources.body`, keeping whatever frontmatter they arrived with, so they have
 * no schema to fit and nothing to map.
 */
export const FRONTMATTER: Readonly<Record<string, string>> = {
  type: 'facts.type',
  title: 'facts.title',
  description: 'facts.description',
  space: 'facts.space',
  tags: 'facts.tags',
  project: 'facts.project',
  // facts.state replaced facts.status in KPA-59. draft/stable/deprecated do
  // not translate onto candidate/proposed/rejected by name, so KPA-5 is the
  // story that writes the translation, not this table.
  status: 'facts.state, translated by KPA-5',
  generated: 'facts.generated',
  generated_by: 'facts.generated_by',
  verified: 'facts.verified',
  verified_by: 'facts.verified_by',
  stale_after: 'facts.stale_after',
  // One edge per entry. A wikilink resolves to a node; a URL becomes a node of
  // kind 'url' carrying the URL in nodes.ref.
  sources: "edges, kind 'derived_from'",
};

/**
 * The frontmatter fields whose values the schema constrains to an enum.
 *
 * The value is the Postgres type. A value in the vault that the type does not
 * list is a schema gap, and the test names both.
 *
 * `status` carries no entry. Checking one here means the vault's raw value is
 * itself a label the named type accepts, and `stable` is not a `fact_state`
 * label -- it needs KPA-5's translation first, not a membership test.
 */
export const ENUMS: Readonly<Record<string, string>> = {
  type: 'fact_type',
  space: 'space',
};

/** The path to the Obsidian vault. Absent on a machine that is not Shane's. */
export function vaultPath(): string {
  const configured = process.env['VAULT_PATH'];
  if (configured) {
    return configured;
  }
  const home = process.env['HOME'] ?? '';
  return `${home}/Development/obsidian_vaults/Memory`;
}

/**
 * The frontmatter keys of one note, in order.
 *
 * This reads keys and never values, so it needs no YAML parser. KPA-5 builds
 * the reader that validates values, and it is the one that has to be exact.
 */
export function frontmatterKeys(text: string): string[] {
  if (!text.startsWith('---')) {
    return [];
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return [];
  }
  return text
    .slice(3, end)
    .split('\n')
    .map((line) => /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

/** The value of one frontmatter key, unquoted and untrimmed of nothing else. */
export function frontmatterValue(text: string, key: string): string | undefined {
  if (!text.startsWith('---')) {
    return undefined;
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return undefined;
  }
  for (const line of text.slice(3, end).split('\n')) {
    const match = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
    if (match) {
      return match[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}
