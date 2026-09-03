// The check the sign-in redirect needs. Run: npm run check
//
// `proxy.ts` puts where somebody was going into `next`, and the sign-in form
// obeys it after the password checks out. An attacker writes that parameter:
// `/sign-in?next=https://evil.example` is a link somebody mails, and a form
// that obeyed it would sign the owner in and hand them to a page that asks for
// the password again.
//
// KPA-128. The rule is proved here, not the form. A DOM assertion needs a test
// runner, and this project has none.

import assert from "node:assert/strict";

import { HOME, safeNext } from "../lib/next-path.ts";

// 1. A path on this box is obeyed, including the ones the proxy actually
//    sends. Each of these is a screen behind the gate.
for (const good of [
  "/dashboard",
  "/audit",
  "/review/stale",
  "/projects/KPA/issues",
  "/sprints/current",
]) {
  assert.equal(safeNext(good), good, `${good} was refused`);
}

// 2. Every shape that sends somebody off this installation. Each one lands on
//    the briefing instead.
const away: Record<string, string> = {
  "another site": "https://evil.example/sign-in",
  "no scheme": "evil.example",
  "protocol relative": "//evil.example",
  "a backslash at the front": "/\\evil.example",
  "a backslash further in": "/dashboard\\@evil.example",
  "a scheme that runs code": "javascript:alert(1)",
  "a data document": "data:text/html,<h1>hi",
};
for (const [what, value] of Object.entries(away)) {
  assert.equal(safeNext(value), HOME, `${value} was obeyed with ${what}`);
}

// 3. Nothing said is the ordinary case: somebody opened /sign-in themselves.
assert.equal(safeNext(null), HOME);
assert.equal(safeNext(undefined), HOME);
assert.equal(safeNext(""), HOME);

// 4. A door is not a destination. Sending somebody back to the page they just
//    signed in on is a loop, and `/api/session` is not a page at all. The rule
//    asks `isPublic`, so this cannot drift from what the proxy lets through.
for (const door of [
  "/sign-in",
  "/forgot-password",
  "/setup",
  "/api/session",
  "/api/account",
  "/reset/whatever-token",
]) {
  assert.equal(safeNext(door), HOME, `${door} was obeyed as a destination`);
}

// 5. The half-match trap `isPublic` already guards. A screen whose name starts
//    with a door's letters is a different screen, and it is still obeyed.
assert.equal(safeNext("/setups-and-teardowns"), "/setups-and-teardowns");

console.log(
  "sign-in OK: a path on this box is obeyed, and everything else lands home"
);
