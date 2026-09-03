/**
 * The probes, and what a vendor's answer becomes on the row.
 *
 * Nothing here reaches a vendor. `probeFor` builds a request and sends
 * nothing, and `verify` takes its fetcher as an argument, so every answer a
 * vendor can give is driven from here. The first real call is somebody
 * connecting an account on the screen.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { probeFor, verify } from '../src/connections/verify.ts';

const KEY = 'sk-secret-value-nobody-should-see';

/** A fetcher answering one status, and recording what it was handed. */
function answering(status: number): {
  fetcher: typeof fetch;
  seen: { url: string; init: RequestInit | undefined }[];
} {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(new Response('', { status }));
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

describe('the probe a provider is verified by', () => {
  test('names one call for each of the four key providers', () => {
    for (const provider of ['openrouter', 'claude', 'linear', 'voyage']) {
      const probe = probeFor(provider, KEY);
      assert.ok(probe, `${provider} names no probe`);
      assert.ok(probe.url.startsWith('https://'), `${provider} is not over TLS`);
      assert.ok(probe.asks.length > 0, `${provider} does not say what it asks`);
    }
  });

  test('never puts the key in the url', () => {
    for (const provider of ['openrouter', 'claude', 'linear', 'voyage']) {
      const probe = probeFor(provider, KEY);
      assert.ok(probe);
      assert.ok(!probe.url.includes(KEY), `${provider} put the key in the url`);
    }
  });

  test('puts the key in a header, in the shape each vendor takes', () => {
    assert.equal(probeFor('openrouter', KEY)?.headers['authorization'], `Bearer ${KEY}`);
    assert.equal(probeFor('claude', KEY)?.headers['x-api-key'], KEY);
    assert.equal(probeFor('linear', KEY)?.headers['authorization'], KEY);
    assert.equal(probeFor('voyage', KEY)?.headers['authorization'], `Bearer ${KEY}`);
  });

  test('anthropic carries the version header its api requires', () => {
    assert.equal(probeFor('claude', KEY)?.headers['anthropic-version'], '2023-06-01');
  });

  test('three cost nothing and Voyage is metered', () => {
    assert.equal(probeFor('openrouter', KEY)?.cost, 'free');
    assert.equal(probeFor('claude', KEY)?.cost, 'free');
    assert.equal(probeFor('linear', KEY)?.cost, 'free');
    // Voyage publishes no endpoint naming a key, so the cheapest call it
    // offers is an embedding. A schedule that re-verifies everything nightly
    // reads this before it decides to.
    assert.equal(probeFor('voyage', KEY)?.cost, 'metered');
  });

  test('a method holding no secret names no probe', () => {
    // Claude's subscription signs in through a browser and stores no key.
    assert.equal(probeFor('claude', ''), null);
    assert.equal(probeFor('claude', '   '), null);
  });

  test('a provider this module does not know names no probe', () => {
    assert.equal(probeFor('google', KEY), null);
  });
});

describe('what a vendor answer becomes on the row', () => {
  test('a 200 verifies', async () => {
    const { fetcher } = answering(200);
    const probe = probeFor('linear', KEY);
    assert.ok(probe);
    const said = await verify(probe, fetcher);
    assert.equal(said.ok, true);
    assert.match(said.verdict, /api\.linear\.app accepted/);
  });

  test('a 401 says the key was refused, and does not throw', async () => {
    const { fetcher } = answering(401);
    const probe = probeFor('openrouter', KEY);
    assert.ok(probe);
    const said = await verify(probe, fetcher);
    assert.equal(said.ok, false);
    assert.match(said.verdict, /refused the key/);
  });

  test('a vendor that is down reads differently from a key that is wrong', async () => {
    const probe = probeFor('claude', KEY);
    assert.ok(probe);
    const down = await verify(probe, answering(503).fetcher);
    const wrong = await verify(probe, answering(403).fetcher);
    assert.equal(down.ok, false);
    assert.equal(wrong.ok, false);
    assert.notEqual(down.verdict, wrong.verdict);
    assert.match(down.verdict, /is failing/);
  });

  test('a rate limit is not a bad key', async () => {
    const probe = probeFor('voyage', KEY);
    assert.ok(probe);
    const said = await verify(probe, answering(429).fetcher);
    assert.match(said.verdict, /rate limiting/);
  });

  test('a network failure is a verdict rather than a throw', async () => {
    const failing = (() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch;
    const probe = probeFor('openrouter', KEY);
    assert.ok(probe);
    const said = await verify(probe, failing);
    assert.equal(said.ok, false);
    assert.match(said.verdict, /could not be reached/);
  });

  test('no verdict carries the key, on any path', async () => {
    for (const status of [200, 401, 429, 500]) {
      for (const provider of ['openrouter', 'claude', 'linear', 'voyage']) {
        const probe = probeFor(provider, KEY);
        assert.ok(probe);
        const said = await verify(probe, answering(status).fetcher);
        assert.ok(!said.verdict.includes(KEY), `${provider} at ${String(status)} leaked the key`);
      }
    }
  });

  test('the key travels in a header and never in the body of a GET', async () => {
    const { fetcher, seen } = answering(200);
    const probe = probeFor('openrouter', KEY);
    assert.ok(probe);
    await verify(probe, fetcher);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.init?.body, undefined);
    assert.ok(!seen[0]?.url.includes(KEY));
  });
});
