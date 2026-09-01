// What a password on this installation has to clear.
//
// This account reaches every mailbox the assistant reads, on a box its owner
// administers alone, so the rules are stricter than a forum's. Sixteen
// characters, a capital, a number, and two marks.
//
// Four rules, written once, in the order they are shown. The screen draws the
// list from here rather than describing it in its own words, because a rule
// the form checks and a rule the screen states have to be the same rule.
//
// A space is not a mark. Somebody asked to type two marks would not count the
// gaps between their words as two of them, and a rule that passes when the
// reader thinks it failed is worse than a strict one.
//
// This file holds no import, so scripts/check-password.ts can run it under
// plain node.

export const PASSWORD_MINIMUM = 16;
export const MARKS_REQUIRED = 2;

export interface Rule {
  text: string;
  met: boolean;
}

/**
 * How many marks the password carries, counting neither letter nor digit.
 *
 * Letters and digits are counted in every alphabet, not only the English
 * one. Counting `Ä` as a mark while refusing it as a capital would tell a
 * German reader their capital letter is punctuation.
 */
function marks(password: string): number {
  return (password.match(/[^\p{L}\p{N}\s]/gu) ?? []).length;
}

/** Every rule, and whether this password meets it. */
export function check(password: string): Rule[] {
  return [
    {
      text: `At least ${PASSWORD_MINIMUM} characters`,
      met: password.length >= PASSWORD_MINIMUM,
    },
    { text: "A capital letter", met: /\p{Lu}/u.test(password) },
    { text: "A number", met: /\p{N}/u.test(password) },
    {
      text: `${MARKS_REQUIRED} marks, such as ! ? or -`,
      met: marks(password) >= MARKS_REQUIRED,
    },
  ];
}

export function passes(password: string): boolean {
  return check(password).every((rule) => rule.met);
}

/**
 * How far along the password is, for the bars above the list.
 *
 * The score counts rules met rather than guessing at entropy, so the bars and
 * the ticks below them can never disagree.
 */
export function strength(password: string): { score: number; label: string } {
  const met = check(password).filter((rule) => rule.met).length;
  if (password.length === 0) return { score: 0, label: "" };
  if (met === 4) return { score: 4, label: "Ready" };
  return { score: met, label: `${met} of 4` };
}
