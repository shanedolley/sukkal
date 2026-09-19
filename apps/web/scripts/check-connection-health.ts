// The check the connection health marks need. Run: npm run check
//
// KPA-107. The card outlines a dead connection in red, and the navigation
// shows a green dot, a yellow warning or a red error for the set. Both read
// `lib/connection-health.ts`, and a wrong answer there is silent: every screen
// renders, and the one that should be red is green.
//
// The card and the navigation are components, which Node cannot import, so
// the last part reads their source for the one thing each must do.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, health, isFailing } from "../lib/connection-health.ts";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const working = { hasSecret: true, verifiedOk: true };
const dead = { hasSecret: true, verifiedOk: false };
const unchecked = { hasSecret: true, verifiedOk: null };
const empty = { hasSecret: false, verifiedOk: null };

// 1. What counts as failing. A connection never checked is unknown, not
//    broken, and one holding no credential cannot work.
assert.equal(isFailing(working), false);
assert.equal(isFailing(dead), true);
assert.equal(isFailing(unchecked), false, "an unchecked connection was painted red on a guess");
assert.equal(isFailing(empty), true, "a connection with no credential read as working");

// 2. The three marks Shane asked for, and none when there is nothing to mark.
assert.equal(health([]), "none");
assert.equal(health([working, working]), "working", "all working must be the green dot");
assert.equal(health([working, dead]), "some-failing", "one failing must be the yellow warning");
assert.equal(health([dead, dead]), "all-failing", "all failing must be the red error");
assert.equal(health([dead]), "all-failing", "the only connection failing is all of them");
assert.equal(health([working, unchecked]), "working");
assert.equal(health([dead, unchecked]), "some-failing", "an unchecked one is not a failure");

// 3. The words the tooltip and a screen reader get.
assert.equal(describe([working, dead, dead]), "2 of 3 connections not working");
assert.equal(describe([dead, dead]), "No connection is working");
assert.equal(describe([working]), "Every connection is working");

// 4. The card outlines in red and carries an error icon only when failing.
const card = await readFile(path.join(WEB, "components", "connections", "connections.tsx"), "utf8");
assert.ok(/const failing = isFailing\(connection\)/.test(card), "the card does not ask isFailing");
assert.ok(/failing\s*\?\s*"ring-destructive[^"]*ring-2/.test(card), "a failing card has no bold red outline");
assert.ok(/\{failing && \(\s*<CircleXIcon/.test(card), "a failing card has no error icon");

// 5. The navigation reads the same rule, for the Connections item, and
//    reads again on a timer so a page left open learns the hourly answer.
const nav = await readFile(
  path.join(WEB, "components", "blocks", "app-shell-1", "components", "nav-secondary.tsx"),
  "utf8",
);
assert.ok(/health\(connections\)/.test(nav), "the navigation does not ask health");
assert.ok(/item\.id === "connections"/.test(nav), "the mark is not on the Connections item");
assert.ok(/state === "working"[\s\S]*bg-success/.test(nav), "all working is not a green dot");
assert.ok(/TriangleAlertIcon/.test(nav) && /text-warning/.test(nav), "some failing is not a yellow warning");
assert.ok(/state === "all-failing" \? CircleXIcon/.test(nav) && /text-destructive/.test(nav), "all failing is not a red error");
assert.ok(/setInterval\(\(\) => void reloadConnections\(\)/.test(nav), "the navigation never reads again");

console.log(
  "connection health OK: unchecked is unknown, no credential is failing, and the card and the navigation both read one rule",
);
