// The check the avatar needs. Run: npm run check
//
// Node cannot load a `.tsx` file: it strips types and leaves JSX alone, so
// `ERR_UNKNOWN_FILE_EXTENSION` is what an import of the component gets. This
// reads the source instead, which is enough for the four things that can break
// here without anything failing.
//
// The first is the one with a known shape. Motion gets added, the
// `prefers-reduced-motion` block does not get the new class, and every check
// still passes: a reader who asked their system for less movement simply gets
// movement. Nothing throws, nothing looks wrong on this machine, and the
// person it was written for is the only one who ever sees it.
//
// KPA-151.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const file = path.join(
  import.meta.dirname,
  "..",
  "components",
  "setup",
  "assistant-avatar.tsx",
);
const source = await readFile(file, "utf8");

// 1. Every class this component animates is switched off under reduced motion.
const style = source.match(/<style>\{`([\s\S]*?)`\}<\/style>/)?.[1];
assert.ok(style, "the component carries no <style> block, so nothing animates");

const [before, reduced] = style.split(
  /@media \(prefers-reduced-motion: reduce\) \{/,
);
assert.ok(
  reduced,
  "the component animates and declares no prefers-reduced-motion rule",
);

const classesIn = (text: string) =>
  new Set(
    [...text.matchAll(/\.([a-z-]+)[^{]*\{[^}]*animation:/g)].map((m) => m[1]),
  );

const animated = classesIn(before ?? "");

// The reduced-motion block lists every selector before one `animation: none`,
// so read the selector list rather than expecting one rule per class.
const stopped = new Set<string>();
for (const rule of reduced.matchAll(/([^{}]+)\{[^{}]*animation:\s*none/g)) {
  for (const one of (rule[1] ?? "").split(",")) {
    const name = one.trim().replace(/^\./, "");
    if (name) stopped.add(name);
  }
}

assert.ok(animated.size > 0, "nothing is animated, so the seam has been lost");
for (const name of animated) {
  assert.ok(
    stopped.has(name),
    `.${name} animates and reduced motion does not stop it`,
  );
}
for (const name of stopped) {
  assert.ok(
    animated.has(name),
    `.${name} is stopped under reduced motion and animates nowhere`,
  );
}

// 2. Every animated class is one the markup actually puts on an element. A
//    rule for a class nobody uses is motion somebody thinks they turned off.
for (const name of animated) {
  assert.ok(
    new RegExp(`["\`][^"\`]*\\b${name}\\b`).test(
      source.replace(/<style>[\s\S]*?<\/style>/, ""),
    ),
    `.${name} animates and no element carries it`,
  );
}

// 3. Two faces. Both the profile and the beard are drawn twice, once mirrored,
//    which is the whole identity: one of them and this is a plain head.
for (const [shape, count] of [
  ["PROFILE", 2],
  ["BEARD", 2],
] as const) {
  const drawn = [...source.matchAll(new RegExp(`d=\\{${shape}\\}`, "g"))].length;
  assert.equal(drawn, count, `${shape} is drawn ${drawn} times, not ${count}`);
}
assert.equal(
  [...source.matchAll(/transform=\{MIRROR\}/g)].length,
  2,
  "the profile and the beard are not both mirrored, so there is one face",
);

// 4. Two crops, and the shoulders belong to one of them. The face crop is the
//    head alone; a face crop carrying shoulders is the full crop with its feet
//    cut off.
const crops = source.match(/viewBox=\{face \? "([^"]+)" : "([^"]+)"\}/);
assert.ok(crops, "the two crops no longer come from one viewBox expression");
assert.notEqual(crops[1], crops[2], "both crops use the same viewBox");
assert.ok(
  /\{!face && \(/.test(source),
  "the shoulders are no longer held behind the full crop",
);

// 5. The busy seam. `busy` stops the float, because a face that bobs while it
//    works reads as idle.
assert.ok(
  /busy \? undefined : "kpa-body"/.test(source),
  "busy no longer stops the float",
);

console.log(
  `avatar OK: ${animated.size} animations and reduced motion stops each, ` +
    `two faces mirrored, and two crops`,
);
