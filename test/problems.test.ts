import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { problems } from '../src/checks/problems.ts';
import { vaultPath } from '../src/vault-mapping.ts';

const SPACES = ['shared', 'collibra', 'koinon', 'personal'] as const;

const GOOD = [
  '---',
  'type: reference',
  'title: A',
  'description: d',
  'space: shared',
  'status: stable',
  'generated: 2026-08-23',
  'generated_by: human:shane',
  '---',
  '',
  'Body linking [[a]].',
  '',
].join('\n');

const TYPES = "['customer', 'decision', 'engagement', 'person', 'policy', 'preference', 'reference', 'source', 'system']";
const STATUSES = "['deprecated', 'draft', 'stable']";

/** A fresh temp vault with the four space directories and one good note at
 *  shared/a.md, matching check.py's own selftest fixture. */
async function makeVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), 'kpa-problems-'));
  for (const space of SPACES) {
    await mkdir(path.join(vault, space));
  }
  await writeFile(path.join(vault, 'shared', 'a.md'), GOOD);
  return vault;
}

/** Writes shared/b.md, a second note next to the good one, and returns the
 *  problems found across the whole vault. */
async function withBadNote(vault: string, text: string): Promise<string[]> {
  await writeFile(path.join(vault, 'shared', 'b.md'), text);
  return problems(vault);
}

describe('problems() reads a note as the migration reads it, which is KPA-74', () => {
  let vault: string;
  before(async () => {
    vault = await makeVault();
  });
  after(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  // check.py keeps the quotes on and reports: type `"reference"` is not one of
  // [...]. The migration unquotes the value and loads a valid reference. This
  // report follows the migration, so scripts/verify-migration.sh shows the
  // disagreement as an UNEXPLAINED line instead of two matching ones.
  test('a quoted type reads as its value, as the load reads it, so no problem is raised', async () => {
    assert.deepEqual(await withBadNote(vault, GOOD.replace('type: reference', 'type: "reference"')), []);
  });

  test('a quoted type the vault does not know still fails, and names the value the load read', async () => {
    assert.deepEqual(await withBadNote(vault, GOOD.replace('type: reference', 'type: "nonsense"')), [
      `shared/b.md: type \`nonsense\` is not one of ${TYPES}`,
    ]);
  });

  test('a quoted description is measured without its quotes, as it is stored', async () => {
    const exactly200 = 'x'.repeat(200);
    assert.deepEqual(
      await withBadNote(vault, GOOD.replace('description: d', `description: "${exactly200}"`)),
      [],
    );
  });
});

describe('problems(), against fixtures built like check.py\'s own selftest', () => {
  let vault: string;

  before(async () => {
    vault = await makeVault();
  });

  after(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  test('a well-formed vault reports nothing', async () => {
    assert.deepEqual(await problems(vault), []);
  });

  test('an unknown type', async () => {
    const found = await withBadNote(vault, GOOD.replace('type: reference', 'type: nonsense'));
    assert.ok(
      found.includes(`shared/b.md: type \`nonsense\` is not one of ${TYPES}`),
      `found: ${JSON.stringify(found)}`,
    );
    assert.ok(found.length > 0, 'a problem is a non-zero exit');
  });

  test('a missing type key reads as the literal word None, matching Python\'s f-string', async () => {
    const found = await withBadNote(vault, GOOD.replace('type: reference\n', ''));
    assert.ok(found.includes(`shared/b.md: type \`None\` is not one of ${TYPES}`), `found: ${JSON.stringify(found)}`);
  });

  test('an unknown status', async () => {
    const found = await withBadNote(vault, GOOD.replace('status: stable', 'status: whenever'));
    assert.ok(
      found.includes(`shared/b.md: status \`whenever\` is not one of ${STATUSES}`),
      `found: ${JSON.stringify(found)}`,
    );
  });

  test('a description over 200 characters', async () => {
    const long = 'x'.repeat(201);
    const found = await withBadNote(vault, GOOD.replace('description: d', `description: ${long}`));
    assert.ok(
      found.includes('shared/b.md: description over 200 characters; it is the index, keep it scannable'),
      `found: ${JSON.stringify(found)}`,
    );
  });

  test('a description of exactly 200 characters does not fail', async () => {
    const exact = 'x'.repeat(200);
    const found = await withBadNote(vault, GOOD.replace('description: d', `description: ${exact}`));
    assert.ok(
      !found.some((line) => line.includes('description over')),
      `found: ${JSON.stringify(found)}`,
    );
  });

  test('verified without verified_by', async () => {
    const found = await withBadNote(vault, GOOD.replace('---\n\nBody', 'verified: 2026-08-23\n---\n\nBody'));
    assert.ok(
      found.includes('shared/b.md: verified without verified_by; who confirmed it?'),
      `found: ${JSON.stringify(found)}`,
    );
  });

  test('verified alongside verified_by does not fail', async () => {
    const found = await withBadNote(
      vault,
      GOOD.replace('---\n\nBody', 'verified: 2026-08-23\nverified_by: human:shane\n---\n\nBody'),
    );
    assert.ok(
      !found.some((line) => line.includes('verified without verified_by')),
      `found: ${JSON.stringify(found)}`,
    );
  });

  test('a wikilink with no note', async () => {
    const found = await withBadNote(vault, GOOD.replace('[[a]]', '[[missing]]'));
    assert.ok(found.includes('shared/b.md: [[missing]] has no note'), `found: ${JSON.stringify(found)}`);
  });

  test('a wikilink to a root page fails until the page exists, then passes, matching check.py', async () => {
    const rootPage = path.join(vault, 'index.md');
    const bare = GOOD.replace('[[a]]', '[[index]]');

    const beforeRoot = await withBadNote(vault, bare);
    assert.ok(beforeRoot.includes('shared/b.md: [[index]] has no note'), `found: ${JSON.stringify(beforeRoot)}`);

    await writeFile(rootPage, '# Memory\n');
    try {
      const afterRoot = await withBadNote(vault, bare);
      assert.ok(!afterRoot.some((line) => line.includes('[[index]] has no note')), `found: ${JSON.stringify(afterRoot)}`);
    } finally {
      await rm(rootPage, { force: true });
    }
  });

  test('a wikilink to a source under sources/ resolves, matching check.py', async () => {
    const sourceDir = path.join(vault, 'sources', 'collibra');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'a-transcript.md'), 'raw\n');
    try {
      const found = await withBadNote(vault, GOOD.replace('[[a]]', '[[a-transcript]]'));
      assert.ok(!found.some((line) => line.includes('[[a-transcript]] has no note')), `found: ${JSON.stringify(found)}`);
    } finally {
      await rm(path.join(vault, 'sources'), { recursive: true, force: true });
    }
  });

  test('a note with no frontmatter triggers none of the six', async () => {
    const found = await withBadNote(vault, 'no frontmatter here');
    assert.ok(
      !found.some((line) => line.startsWith('shared/b.md:')),
      `a frontmatter-less note should report nothing from the six: ${JSON.stringify(found)}`,
    );
  });
});

describe('the 120-note space ceiling', () => {
  let vault: string;

  before(async () => {
    vault = await makeVault();
    for (let i = 0; i < 121; i += 1) {
      await writeFile(path.join(vault, 'personal', `note-${i}.md`), GOOD.replace('space: shared', 'space: personal'));
    }
  });

  after(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  test('over the ceiling is a failure and a non-zero exit, not a full report match', async () => {
    const found = await problems(vault);
    assert.ok(found.length > 0, 'a problem is a non-zero exit');
    assert.ok(
      found.includes(
        'personal/: 121 notes, over the 120 ceiling. Merge or retire before adding more, or raise the ceiling deliberately.',
      ),
      `found: ${JSON.stringify(found)}`,
    );
  });
});

describe('a vault path that does not exist', () => {
  test('reports nothing rather than throwing', async () => {
    assert.deepEqual(await problems('/nonexistent-vault-for-kpa-32'), []);
  });
});

const vaultReason = existsSync(vaultPath()) ? false : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('against the frozen vault, compared with scripts/check.py at commit da7afce', { skip: vaultReason }, () => {
  test('reports nothing, matching check.py\'s own check() on the same commit', async () => {
    assert.deepEqual(await problems(vaultPath()), []);
  });
});
