// The check the password rules need. Run: npm run check
//
// Four rules guard the only account on the installation, and each one is a
// line somebody can trip over. A rule that passes a password it should refuse
// is the kind of fault nobody sees until it matters.

import assert from "node:assert/strict";

import {
  check,
  MARKS_REQUIRED,
  PASSWORD_MINIMUM,
  passes,
  strength,
} from "../lib/password.ts";

// 1. One that meets every rule.
const good = "Correct-Horse!7Battery";
assert.ok(good.length >= PASSWORD_MINIMUM);
assert.ok(passes(good), `${good} should pass`);
assert.equal(strength(good).label, "Ready");

// 2. Each rule refuses on its own, with the other three met.
const misses: Record<string, string> = {
  "too short": "Ab!c-1de",
  "no capital": "correct-horse!7battery",
  "no number": "Correct-Horse!Battery",
  "one mark": "CorrectHorse-7Battery",
  "no mark": "CorrectHorse7Battery0",
};
for (const [what, password] of Object.entries(misses)) {
  assert.ok(!passes(password), `${password} passed with ${what}`);
}

// 3. The boundary itself, from both sides. A rule tested only well inside
//    its limit passes whether it reads "at least 16" or "more than 16".
const fifteen = "Ab!c-1defghijkl";
const sixteen = "Ab!c-1defghijklm";
assert.equal(fifteen.length, PASSWORD_MINIMUM - 1);
assert.equal(sixteen.length, PASSWORD_MINIMUM);
assert.ok(!passes(fifteen), "one short of the minimum passed");
assert.ok(passes(sixteen), "exactly the minimum was refused");

// 4. A capital is a capital in every alphabet, and a letter is never a mark.
//    Counting "Ä" as punctuation would refuse a German password twice over.
assert.ok(passes("Ärger-ist!7schlimm"), "a non-English capital was refused");
assert.ok(!passes("ärger-ist!7schlimm"), "a password with no capital passed");

// 5. A space is not a mark. Somebody told to type two marks would not count
//    the gaps between their words, so neither does the rule.
assert.ok(!passes("Correct Horse 7 Battery"));

// 6. Two marks means two, not two kinds. The same mark twice is two marks.
assert.ok(passes("Correct!!Horse7Battery"));
assert.equal(MARKS_REQUIRED, 2);

// 7. The bars count the rules met, so the meter and the ticks under it can
//    never disagree.
for (const password of Object.values(misses)) {
  const met = check(password).filter((rule) => rule.met).length;
  assert.equal(strength(password).score, met);
  assert.ok(met < 4, `${password} met every rule`);
}
assert.equal(strength("").score, 0);
assert.equal(strength("").label, "");

console.log(
  "password OK: 16 characters, a capital, a number and two marks, each refused on its own"
);
