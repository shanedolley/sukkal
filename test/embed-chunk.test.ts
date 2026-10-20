import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chunkBody, MAX_CHARS, MIN_CHARS } from '../src/embed/chunk.ts';
import { chunkText } from '../src/memory/source.ts';

/** Every chunk's text, read back from the original by its byte range. */
function texts(body: string): string[] {
  return chunkBody(body).map((chunk) => chunkText(body, chunk));
}

const paragraph = (word: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `${word} sentence ${i}.`).join(' ');

describe('chunkBody', () => {
  test('starts a chunk at a heading once the one before is long enough', () => {
    const first = paragraph('alpha', 20);
    const second = paragraph('beta', 20);
    const body = `---\ntitle: x\n---\n\n# One\n\n${first}\n\n# Two\n\n${second}\n`;

    assert.deepEqual(texts(body), [`# One\n\n${first}`, `# Two\n\n${second}`]);
  });

  test('joins a short section to the next rather than leaving a stub', () => {
    const body = `# Tiny\n\nshort.\n\n# Next\n\n${paragraph('gamma', 10)}\n`;
    const [only, ...rest] = texts(body);

    assert.equal(rest.length, 0);
    assert.ok(only?.startsWith('# Tiny'));
    assert.ok(only?.includes('# Next'));
  });

  test('skips frontmatter and returns nothing for a blank body', () => {
    assert.deepEqual(texts('---\ntitle: x\n---\nhello there\n'), ['hello there']);
    assert.deepEqual(chunkBody(''), []);
    assert.deepEqual(chunkBody(' \n\n \n'), []);
  });

  test('keeps a fenced block whole, blank lines and # lines included', () => {
    const body = '```\n# not a heading\n\nstill code\n```\n';
    assert.deepEqual(texts(body), [body.trimEnd()]);
  });

  test('cuts a long paragraph at sentence ends, never inside a sentence', () => {
    const body = paragraph('delta', 300);
    const pieces = texts(body);

    assert.ok(pieces.length > 1);
    for (const piece of pieces) {
      assert.ok(piece.length <= MAX_CHARS, `${piece.length} characters`);
      assert.ok(piece.endsWith('.'), piece.slice(-20));
      assert.ok(piece.length > MIN_CHARS);
    }
    assert.equal(pieces.join(' '), body, 'nothing lost between the pieces');
  });

  test('maps every range back to the original bytes past non-ASCII text', () => {
    // 日本語 is 9 bytes for 3 code units and the emoji is 4 bytes for 2, so
    // a range counted in characters would land well short of the bytes.
    const sentence = '日本語のテキスト 😀 café naïve. ';
    const body = `# 見出し\n\n${sentence.repeat(120)}\n\n# Second\n\n${sentence.repeat(5)}`;
    const chunks = chunkBody(body);
    const bytes = Buffer.from(body, 'utf8');

    assert.ok(chunks.length > 2);
    let cursor = 0;
    for (const chunk of chunks) {
      const text = bytes.subarray(chunk.byteStart, chunk.byteEnd).toString('utf8');
      assert.ok(!text.includes('�'), 'no character cut in half');
      assert.equal(chunkText(body, chunk), text);
      // The text sits in the original at exactly this byte offset.
      const at = body.indexOf(text, cursor);
      assert.notEqual(at, -1);
      assert.equal(chunk.byteStart, Buffer.byteLength(body.slice(0, at), 'utf8'));
      cursor = at + text.length;
    }
    assert.notEqual(Buffer.byteLength(body, 'utf8'), body.length);
  });

  test('cuts a run with no break between characters, never inside a surrogate pair', () => {
    const body = '😀'.repeat(MAX_CHARS);
    const pieces = texts(body);

    assert.ok(pieces.length > 1);
    assert.equal(pieces.join(''), body);
    for (const piece of pieces) assert.ok(!piece.includes('�'));
  });

  test('treats CRLF line ends like LF', () => {
    const body = `# One\r\n\r\n${paragraph('eps', 20)}\r\n\r\n# Two\r\n\r\n${paragraph('zeta', 20)}\r\n`;
    assert.equal(chunkBody(body).length, 2);
  });
});
