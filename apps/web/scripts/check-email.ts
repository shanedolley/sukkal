// The check the email rule needs. Run: npm run check
//
// Three forms ask whether a value looks like an address, and all three call
// this one rule. It decides whether the submit goes through and whether the
// person sees a message. A rule that accepts "shane@" lets the form submit and
// says nothing, which is the fault this catches.
//
// KPA-37. The rule is proved here, not the form. A DOM assertion needs a test
// runner, and this project has none.

import assert from "node:assert/strict";

import { looksLikeEmail } from "../lib/email.ts";

// 1. The addresses a person actually types. Each one clears the field.
for (const good of [
  "shane@koinon.com.au",
  "shane.dolley@collibra.com",
  "s@b.co",
  "first+tag@sub.domain.org",
]) {
  assert.ok(looksLikeEmail(good), `${good} was refused`);
}

// 2. Every shape the form has to refuse. Each one blocks the submit and shows
//    the message.
const bad: Record<string, string> = {
  empty: "",
  "no at": "shane.koinon.com.au",
  "nothing before the at": "@koinon.com.au",
  "nothing after the at": "shane@",
  "no dot in the domain": "shane@koinon",
  "two ats": "shane@@koinon.com.au",
  "a space inside": "shane dolley@koinon.com.au",
  "a dot with nothing after it": "shane@koinon.",
};
for (const [what, value] of Object.entries(bad)) {
  assert.ok(!looksLikeEmail(value), `"${value}" passed with ${what}`);
}

// 3. The pair the story asks for: a bad address is refused, and correcting it
//    clears the message.
assert.ok(!looksLikeEmail("shane@koinon"));
assert.ok(looksLikeEmail("shane@koinon.com"));

// 4. Space around a pasted address is a typo, not a refusal. The rule trims
//    before it decides, so the form and the rule agree on what was typed.
assert.ok(looksLikeEmail("  shane@koinon.com.au  "), "a pasted address failed");
assert.ok(!looksLikeEmail("   "), "whitespace alone passed");

console.log(
  "email OK: the shapes a form must refuse are refused, and a correction clears"
);
