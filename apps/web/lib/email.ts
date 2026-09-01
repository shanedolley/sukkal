// Whether something looks like an email address.
//
// Deliberately loose. It catches the typo and nothing more: a trust boundary
// needs a real check on the server, and no screen here has one. It lives in
// one place because three forms ask the same question, and three copies of a
// rule drift the day one of them is tightened.

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return SHAPE.test(value.trim());
}
