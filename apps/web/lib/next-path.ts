/**
 * Where a sign-in lands, given the `next` the gate put in the address.
 *
 * `proxy.ts` redirects a signed-out browser to `/sign-in?next=/audit`, so the
 * form has to send somebody on afterwards. That parameter is typed by whoever
 * built the link, which makes it a trust boundary rather than a convenience.
 *
 * AN ATTACKER WRITES THE PARAMETER. `/sign-in?next=https://evil.example` is a
 * link somebody mails, and a form that obeyed it would sign the owner in and
 * then hand them to a page that looks like this one and asks again. Only a
 * path on this installation is obeyed, and everything else lands on the
 * briefing.
 *
 * `isPublic` decides the second rule, so the two cannot disagree. Every public
 * path is a door rather than a destination: sending somebody back to
 * `/sign-in` after they signed in is a loop, and `/api/session` is not a page.
 */
import { isPublic } from "./public-paths.ts";

/** Where somebody lands when the parameter says nothing usable. */
export const HOME = "/dashboard";

/**
 * The path to open after a sign-in.
 *
 * A backslash is refused anywhere in the value, not only at the front.
 * Browsers have treated `/\evil.example` as protocol-relative, so a rule that
 * only looked for `//` would let that one through.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return HOME;
  if (!value.startsWith("/")) return HOME;
  if (value.startsWith("//") || value.includes("\\")) return HOME;
  if (isPublic(value)) return HOME;
  return value;
}
