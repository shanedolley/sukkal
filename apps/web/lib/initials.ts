/**
 * The letters an avatar shows when there is no picture.
 *
 * Derived from the name on the account row rather than stored beside it,
 * because a stored pair drifts from the name it came from the first time
 * somebody edits one. Nothing in this installation holds a picture of the
 * owner, so this is what the avatar always renders.
 *
 * It lives in its own module for one reason: `nav-user.tsx` is a client
 * component and imports React, so a check cannot reach into it under plain
 * node. `apps/web/scripts/check-account.ts` runs the rule here instead.
 *
 * KPA-144. The name used to be `Shane Dolley` in code, which ADR-0009 made
 * wrong on every installation but his.
 */

/**
 * The first letter of the first word and of the last, upper case.
 *
 * One word gives one letter, which is what a person with one name gets
 * everywhere else. Nothing usable gives a question mark rather than an empty
 * circle, because an avatar with no glyph reads as a rendering fault.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  // Spread rather than index. A name starting with an emoji or an accented
  // letter outside the basic plane is two code units, and `[0]` cuts it in
  // half into a character no font draws.
  const letter = (word: string): string => [...word][0] ?? "";
  return `${letter(first)}${letter(last)}`.toUpperCase() || "?";
}
