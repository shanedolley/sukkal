// The Content-Security-Policy, in the one place that writes it.
//
// KPA-148 asks for the header that stops a stored string running as script.
// Sukkal holds strings it did not write, from a nabium delivery, a tracker's
// issue description and a mailbox, and React escaping is the only thing that
// stood between one of them and the document. This is the second layer.
//
// `proxy.ts` calls this on every request and `scripts/check-csp.ts` calls it to
// assert what it says, so the policy a browser receives is the policy the check
// reads. A check holding its own copy of the string proves that the copy is
// right.
//
// ADR-0025 decides the shape, and the short version is that a hash was never
// available. Every page carries four to six inline scripts and only three are
// constant: the appearance bootstrap, `next-themes`, and a 43-byte line that
// creates `self.__next_f`. The rest is the flight payload, which carries the
// rendered page, so eleven pages produced sixteen distinct hashes and one
// dynamic route produced eight across three of its own URLs. A hash of
// something rendered from the database at request time cannot be written at
// build time.
//
// SO THE NONCE COSTS EVERY PRERENDERED ROUTE, and the root layout pays it with
// one line. Next injects a nonce during server rendering, so prerendered HTML
// carries none and its own scripts would be refused: a green build and a blank
// page.

/** A nonce is 128 bits, which is what makes guessing it not a strategy. */
export const NONCE_BYTES = 16;

/** The header Next reads the nonce back out of, and the name the guide uses. */
export const NONCE_HEADER = "x-nonce";

/**
 * What every document response carries.
 *
 * `script-src` names `'strict-dynamic'`, which makes the browser ignore `'self'`
 * and trust only a nonced script and whatever such a script creates. Next puts
 * the nonce on the framework bundles as well as the inline scripts, so the
 * fifteen `<script src>` tags are covered by the same nonce rather than by the
 * origin. `'self'` stays in the list because a browser too old for
 * `'strict-dynamic'` falls back to it rather than to nothing.
 *
 * NO HASH BELONGS IN `script-src`. A `script-src` holding any hash or nonce
 * makes the browser ignore `'unsafe-inline'`, and adding the three constant
 * hashes beside the nonce would buy nothing while looking like it bought
 * something.
 *
 * `style-src` KEEPS `'unsafe-inline'`, AND A NONCE COULD NOT HAVE REPLACED IT.
 * A nonce applies to a `<style>` element and never to a `style` attribute. The
 * rendered HTML carries no `<style>` element and two to twenty-one `style`
 * attributes a page: the sidebar's width, an `aspect-ratio`, and the colour
 * swatches on the settings screen, whose values come from the appearance
 * presets. `'unsafe-hashes'` with a hash per value is the only alternative and
 * the swatch values move with the presets. Injected CSS cannot run script,
 * which is what makes this the small concession and `script-src` the large one.
 *
 * `'unsafe-eval'` IS DEVELOPMENT ONLY. React uses `eval` there to rebuild a
 * server stack in the browser. Neither React nor Next uses it in production.
 *
 * `frame-ancestors 'none'` REPLACES NOTHING. KPA-146's `X-Frame-Options: DENY`
 * stays in `next.config.ts`, because a browser too old to read this directive
 * still reads that header.
 *
 * `upgrade-insecure-requests` IS DELIBERATELY ABSENT. Sukkal answers on
 * `http://localhost` and at no other address, so the directive would govern a
 * deployment that does not exist. KPA-147 insists on HTTPS once there is one,
 * and it is the story that adds this.
 */
export function policy(nonce: string, development: boolean): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");
}
