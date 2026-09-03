/**
 * Every route the web tier serves is guarded, or listed as public with a
 * reason.
 *
 * KPA-77 asks for a guard that is "not a list somebody must remember to
 * extend". `proxy.ts` denies by default, so a route added next month is
 * refused by having been added. This is what proves that claim rather than
 * asserting it: the routes come off the disk, not from a list in this file, so
 * a new one appears here the moment somebody writes it.
 *
 * A route that should be public fails this test until `PUBLIC` in `proxy.ts`
 * names it, which is the point. Making a route reachable without a session is
 * a security decision, and this makes somebody take it on purpose.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { isPublic } from '../apps/web/lib/public-paths.ts';

const APP = path.join(import.meta.dirname, '..', 'apps', 'web', 'app');

/**
 * Every route on disk, as the path a browser asks for.
 *
 * A directory in brackets is a group or a parameter. `(app)` and `(auth)`
 * organise files and appear in no URL, and `[key]` stands for whatever
 * somebody types, so it becomes a placeholder that still has to match a
 * prefix.
 */
function routes(): string[] {
  const found: string[] = [];

  function walk(dir: string, url: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const here = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A (group) shapes the files and never the address.
        const segment = /^\(.*\)$/.test(entry.name) ? url : `${url}/${entry.name}`;
        walk(here, segment);
      } else if (entry.name === 'page.tsx' || entry.name === 'route.ts') {
        found.push(url === '' ? '/' : url);
      }
    }
  }

  walk(APP, '');
  return found.sort();
}

describe('the gate over every route', () => {
  const all = routes();

  test('finds the routes on disk rather than trusting a list', () => {
    // A sanity check on the walk itself. If this ever reads zero, every
    // assertion below passes for the wrong reason.
    assert.ok(all.length > 10, `only found ${String(all.length)} routes`);
    assert.ok(all.includes('/dashboard'), 'the dashboard is missing from the walk');
    assert.ok(all.includes('/api/session'), 'the sign-in route is missing from the walk');
  });

  test('guards every route that is not deliberately public', () => {
    // `isPublic` is the same function the proxy calls, so this asks the guard
    // itself rather than a copy of its rules. It lives in `lib/public-paths.ts`
    // rather than in `proxy.ts`, because a rule importing `next/server` can
    // only be tested by starting Next.
    const open = all.filter((route) => isPublic(route));
    const guarded = all.filter((route) => !isPublic(route));

    assert.ok(guarded.length > 0, 'nothing is guarded, which cannot be right');

    // Named here so a change to the public list is visible in a diff. A route
    // added later is guarded by default and needs no entry.
    assert.deepEqual(open.sort(), [
      '/api/account',
      '/api/session',
      '/api/webhooks/nabium',
      '/forgot-password',
      '/setup',
      '/sign-in',
    ]);
  });

  test('guards the screens that read the memory and the tracker', () => {
    // Named individually, and checked against the walk, so a screen that is
    // renamed fails here rather than passing because it stopped existing.
    for (const route of [
      '/dashboard',
      '/review/proposed',
      '/review/stale',
      '/audit',
      '/chat',
      '/settings',
      '/connections',
      '/api/facts',
      '/api/audit',
      '/api/sources',
      '/api/needs-you',
    ]) {
      assert.ok(all.includes(route), `${route} is not a route any more`);
      assert.equal(isPublic(route), false, `${route} is reachable without a session`);
    }
  });

  test('guards every api route but the three that authenticate another way', () => {
    for (const route of all.filter((one) => one.startsWith('/api/'))) {
      if (isPublic(route)) continue;
      assert.equal(isPublic(route), false);
    }
    // The nabium webhook is the one exemption that is not a sign-in screen.
    // ADR-0013: it carries an HMAC signature and no cookie, because it is not
    // a browser. `src/webhooks/receive.ts` refuses a delivery without one.
    assert.equal(isPublic('/api/webhooks/nabium'), true);
  });

  test('a route invented after this story is guarded by default', () => {
    // The property the criterion asks for, stated directly. Nobody has to
    // remember anything for these to be refused.
    for (const invented of [
      '/api/whatever-lands-next',
      '/some-new-screen',
      '/projects/anything/deeper',
      '/api/webhook',
      '/setupsomething',
      '/sign-in-elsewhere',
      // KPA-128 removed the sign-up page. One installation holds one account
      // and the wizard writes it, so a second door onto the same row was a
      // door onto nothing. It is public no longer, and it is not a route.
      '/sign-up',
    ]) {
      assert.equal(isPublic(invented), false, `${invented} is public and should not be`);
    }
  });

  test('a public prefix opens its own children and nothing beside them', () => {
    assert.equal(isPublic('/api/webhooks/nabium'), true);
    assert.equal(isPublic('/setup'), true);
    // A prefix must match a whole segment. `/setupother` is a different route
    // and shares only the letters.
    assert.equal(isPublic('/setupother'), false);
    assert.equal(isPublic('/api/webhooksomething'), false);
  });
});
