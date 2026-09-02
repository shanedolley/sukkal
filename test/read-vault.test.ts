import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parseNote, readVault } from '../src/migrate/read-vault.ts';
import { vaultPath } from '../src/vault-mapping.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'vault');

describe('parseNote', () => {
  test('splits a flow sequence on its top-level commas, not the ones a quoted item carries', () => {
    const { frontmatter } = parseNote(
      '---\nsources: ["Shane, 25 August 2026", "https://example.com"]\n---\n',
    );
    assert.deepEqual(frontmatter['sources'], ['Shane, 25 August 2026', 'https://example.com']);
  });

  test('unescapes a quoted scalar carrying its own quotes', () => {
    const { frontmatter } = parseNote(
      '---\ndescription: "Marinucci Australia, Koinon\'s client: who to deal with"\n---\n',
    );
    assert.equal(frontmatter['description'], "Marinucci Australia, Koinon's client: who to deal with");
  });

  test('a note with no frontmatter block returns its whole text as body', () => {
    const { frontmatter, body } = parseNote('Just prose, no --- block.\n');
    assert.deepEqual(frontmatter, {});
    assert.equal(body, 'Just prose, no --- block.\n');
  });
});

describe('readVault, against the fixtures', () => {
  test('accepts one valid note per space and translates stable to proposed', async () => {
    const report = await readVault(FIXTURES);

    const bySpace = new Map(report.facts.map((fact) => [fact.space, fact]));
    for (const space of ['collibra', 'koinon', 'personal', 'shared'] as const) {
      const fact = bySpace.get(space);
      assert.ok(fact, `no valid fact read for ${space}`);
      assert.equal(fact.state, 'proposed', `${space}: stable should translate to proposed`);
    }
  });

  test('fails a note missing a required field, and names the field', async () => {
    const report = await readVault(FIXTURES);
    const found = report.failures.find((entry) => entry.file.endsWith('missing-field.md'));
    assert.ok(found, 'missing-field.md was not reported as a failure');
    assert.ok(
      found.failures.some((failure) => failure.field === 'description'),
      `expected a failure naming "description", got: ${JSON.stringify(found.failures)}`,
    );
  });

  test('fails a note carrying a field nothing maps, and names the field', async () => {
    const report = await readVault(FIXTURES);
    const found = report.failures.find((entry) => entry.file.endsWith('unknown-field.md'));
    assert.ok(found, 'unknown-field.md was not reported as a failure');
    assert.ok(
      found.failures.some((failure) => failure.field === 'priority'),
      `expected a failure naming "priority", got: ${JSON.stringify(found.failures)}`,
    );
  });

  test('fails a note carrying a relative date, and names the field', async () => {
    const report = await readVault(FIXTURES);
    const found = report.failures.find((entry) => entry.file.endsWith('relative-date.md'));
    assert.ok(found, 'relative-date.md was not reported as a failure');
    assert.ok(
      found.failures.some((failure) => failure.field === 'generated'),
      `expected a failure naming "generated", got: ${JSON.stringify(found.failures)}`,
    );
  });

  test('fails a note whose status is outside the vault vocabulary, and names the field', async () => {
    const report = await readVault(FIXTURES);
    const found = report.failures.find((entry) => entry.file.endsWith('bad-status.md'));
    assert.ok(found, 'bad-status.md was not reported as a failure');
    assert.ok(
      found.failures.some((failure) => failure.field === 'status'),
      `expected a failure naming "status", got: ${JSON.stringify(found.failures)}`,
    );
  });

  test('reads a sources/ note with the short, hand-written frontmatter, unvalidated', async () => {
    const report = await readVault(FIXTURES);
    const found = report.sources.find((entry) => entry.file.endsWith('short.md'));
    assert.ok(found, 'sources/example/short.md was not read');
    assert.equal(found.frontmatter['type'], 'meeting');
    assert.ok(!report.failures.some((entry) => entry.file.endsWith('short.md')));
  });

  test('reads a sources/ note with no frontmatter at all', async () => {
    const report = await readVault(FIXTURES);
    const found = report.sources.find((entry) => entry.file.endsWith('no-frontmatter.md'));
    assert.ok(found, 'sources/example/no-frontmatter.md was not read');
    assert.deepEqual(found.frontmatter, {});
  });

  test('totals match the fixture files on disk, with zero silent skips', async () => {
    const report = await readVault(FIXTURES);
    assert.equal(report.filesRead, 10, `expected 10 fixture files, read ${report.filesRead}`);
    assert.equal(report.filesRead, report.filesValid + report.filesFailed);
    assert.equal(report.filesValid, 6, `4 valid space notes + 2 sources notes`);
    assert.equal(report.filesFailed, 4);
  });
});

const vaultReason = existsSync(vaultPath()) ? false : `no vault at ${vaultPath()}. Set VAULT_PATH`;

describe('readVault, against the frozen vault', { skip: vaultReason }, () => {
  test('reads every note with zero silent skips and zero failures', async () => {
    const report = await readVault();
    assert.equal(report.filesFailed, 0, `unexpected failures: ${JSON.stringify(report.failures)}`);
    assert.equal(report.filesRead, report.filesValid);
    assert.equal(report.facts.length, 19, 'the frozen vault holds 19 fact notes across its spaces');
    assert.equal(report.sources.length, 32, 'the frozen vault holds 32 source notes');
    for (const fact of report.facts) {
      assert.equal(fact.state, 'proposed', `${fact.file}: every note in the frozen vault reads stable`);
    }
  });
});
