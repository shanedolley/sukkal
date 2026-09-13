// The check the Content-Security-Policy needs. Run: npm run check
//
// KPA-148. A policy written casually breaks one screen in a way nobody sees
// until they open it, and a policy weakened casually keeps every screen working
// and protects nothing. Both failures are silent, which is why this exists.
//
// It calls `lib/csp.ts` rather than holding its own copy of the string, so what
// is asserted here is what a browser receives. Then it reads `proxy.ts` and the
// three files that carry the nonce, because a perfect policy on none of the
// response paths is a header nobody gets.
//
// ADR-0025 records why this is a nonce and not a hash. Every claim below that
// says "a browser would" was seen in Chrome on 13 September 2026 against
// `next start`, not reasoned about.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NONCE_BYTES, NONCE_HEADER, policy } from "../lib/csp.ts";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const NONCE = "TESTNONCEzzzzzzzzzzzzzz==";
const live = policy(NONCE, false);
const development = policy(NONCE, true);

/** One directive out of the policy, by name. */
function directive(name: string, from = live): string {
  const found = from
    .split("; ")
    .find((one) => one === name || one.startsWith(`${name} `));
  assert.ok(found, `the policy names no ${name} at all`);
  return found;
}

// 1. A nonce is 128 bits. Sixteen bytes is what makes guessing it not a
//    strategy, and the whole policy rests on the nonce being unguessable.
assert.equal(NONCE_BYTES, 16, "the nonce is no longer 128 bits");

// 2. `default-src 'self'` is the floor. Every directive the policy does not
//    name falls back to it, so a resource type nobody thought of is refused by
//    having been forgotten rather than allowed by it.
assert.equal(directive("default-src"), "default-src 'self'", "default-src is not 'self'");

// 3. The nonce reaches the policy, and the policy carries the one it was given.
//    `proxy.ts` mints a fresh one per request, so a policy that embedded a
//    constant would be a nonce in name only.
assert.ok(
  directive("script-src").includes(`'nonce-${NONCE}'`),
  "script-src does not carry the nonce it was handed",
);

// 4. `'strict-dynamic'`, which is what covers the flight payload. Next puts the
//    nonce on the scripts it emits and `'strict-dynamic'` extends that trust to
//    whatever those create, and to nothing that arrives as parsed markup. A
//    stored string reaching the document is parsed markup, which is the threat.
assert.ok(
  directive("script-src").includes("'strict-dynamic'"),
  "script-src lost 'strict-dynamic', so a nonced script can no longer load a chunk",
);

// 5. NO `'unsafe-inline'` IN script-src, EVER. It is the one word that would
//    turn this header into decoration: an injected inline handler would run and
//    every screen would keep working, so nothing would say so.
assert.ok(
  !directive("script-src").includes("'unsafe-inline'"),
  "script-src allows 'unsafe-inline', which permits exactly what KPA-148 refuses",
);

// 6. NO HASH IN script-src. A script-src holding a hash or a nonce makes the
//    browser ignore 'unsafe-inline' entirely, so mixing them reads as a
//    belt-and-braces policy and is a trap. The nonce covers all four to six
//    inline scripts, so the three constant hashes would buy nothing.
assert.ok(
  !/'sha(256|384|512)-/.test(directive("script-src")),
  "script-src carries a hash. ADR-0025 says the flight payload cannot be hashed",
);

// 7. `'unsafe-eval'` IS DEVELOPMENT ONLY. React uses `eval` there to rebuild a
//    server stack in the browser. Neither React nor Next uses it in production,
//    so its presence in a live policy is a leak from a development branch.
assert.ok(
  !directive("script-src").includes("'unsafe-eval'"),
  "the live policy allows 'unsafe-eval'",
);
assert.ok(
  directive("script-src", development).includes("'unsafe-eval'"),
  "development has no 'unsafe-eval', so React cannot rebuild a server stack",
);

// 8. `style-src` KEEPS `'unsafe-inline'`, AND A NONCE IS NOT AN UPGRADE HERE.
//    A nonce applies to a <style> element and never to a `style` attribute. The
//    settings screen carries nineteen of those and the sprint board twenty-one:
//    the sidebar's width, an aspect-ratio, and the colour swatches. Serving
//    `style-src 'self' 'nonce-...'` raised nineteen violations on the settings
//    screen in Chrome on 13 September 2026, one per attribute. This assertion
//    is what makes a later edit toward the stricter-looking value fail and read
//    why.
assert.ok(
  directive("style-src").includes("'unsafe-inline'"),
  "style-src lost 'unsafe-inline'. ADR-0025: a nonce cannot cover a style attribute, and nineteen of them are on the settings screen alone",
);

// 9. The four directives that close the paths a policy is usually faulted for
//    leaving open.
for (const [name, want] of [
  ["object-src", "object-src 'none'"],
  ["base-uri", "base-uri 'self'"],
  ["form-action", "form-action 'self'"],
  ["frame-ancestors", "frame-ancestors 'none'"],
] as const) {
  assert.equal(directive(name), want, `${name} is not ${want}`);
}

// 10. `upgrade-insecure-requests` IS ABSENT ON PURPOSE. Sukkal answers on
//     `http://localhost` and nowhere else, so the directive would govern a
//     deployment that does not exist. KPA-147 insists on HTTPS once there is an
//     address and is the story that adds it. This fails if somebody adds it
//     early, because there is nothing here to test it against.
assert.ok(
  !live.includes("upgrade-insecure-requests"),
  "upgrade-insecure-requests is set, and KPA-147 is the story that owns it",
);

// 11. No origin but this one. A policy that names a host has let something in,
//     and the rendered HTML of eleven screens referenced no external origin at
//     all on 13 September 2026: the fonts are self-hosted by next/font at build
//     time.
assert.ok(
  !/https?:\/\//.test(live),
  "the policy names an external origin, so something now loads from one",
);

// 12. Every path out of the proxy carries the header. A policy on the page
//     somebody is sent to and not on the page that sent them is a gap shaped
//     exactly like the one a redirect is used to slip through. `proxy.ts` is
//     read rather than imported, because it imports `next/server` and that does
//     not resolve under node --experimental-strip-types.
const proxy = await readFile(path.join(WEB, "proxy.ts"), "utf8");

assert.equal(
  (proxy.match(/\.headers\.set\('Content-Security-Policy',/g) ?? []).length,
  3,
  "the proxy does not set the policy on all three of its responses: the page, the 401 and the redirect",
);

// 13. NOT Report-Only. The story shipped report-only first and the enforcing
//     header is the end state, so a header left reporting would be a policy
//     that watches a break happen.
assert.ok(
  !proxy.includes("Content-Security-Policy-Report-Only"),
  "the proxy still sends Report-Only, which reports a violation and permits it",
);

// 14. THE REQUEST HEADER KEEPS THE ENFORCING NAME, and it is the subtle one.
//     Next parses `Content-Security-Policy` off the REQUEST to find the nonce
//     and put it on every script it emits. Renaming that one to Report-Only for
//     a report-only pass stops the injection, so the pass reports violations the
//     enforcing build would never have had and the report is worthless.
assert.ok(
  /headers\.set\('Content-Security-Policy', csp\)/.test(proxy),
  "the proxy does not put the policy on the request, so Next injects no nonce",
);
assert.ok(
  proxy.includes(`NONCE_HEADER`) && NONCE_HEADER === "x-nonce",
  "the proxy no longer sets x-nonce, which is where the root layout reads it",
);

// 15. EVERY NONCE IS FRESH AND RANDOM, not just the first one. The proxy mints
//     one for the page and one for the refusal path, so counting them is the
//     assertion: checking that `randomBytes` appears at all passed a proxy whose
//     first mint had been replaced by a constant, which is how this check was
//     caught being too weak on 13 September 2026.
const mints = proxy.match(/const nonce = /g) ?? [];
const random = proxy.match(/randomBytes\(NONCE_BYTES\)\.toString\('base64'\)/g) ?? [];
assert.ok(mints.length > 0, "the proxy mints no nonce at all");
assert.equal(
  random.length,
  mints.length,
  `the proxy mints ${mints.length} nonces and only ${random.length} of them come from randomBytes, so one is a constant an attacker reads off any page`,
);

// 16. Nothing is prerendered. Next injects the nonce during server rendering,
//     so a prerendered page carries none and its own scripts are refused: the
//     build stays green and the page comes up blank. ADR-0025 took the seven to
//     nine milliseconds a load that this costs.
const layout = await readFile(path.join(WEB, "app", "layout.tsx"), "utf8");
assert.ok(
  /export const dynamic = "force-dynamic"/.test(layout),
  "the root layout no longer forces dynamic rendering, so a prerendered page will serve scripts the policy refuses",
);

// 17. The root layout reads the nonce and hands it to the two scripts Next did
//     not write. Next nonces its own and these are not its own.
assert.ok(
  layout.includes(`headers()).get(NONCE_HEADER)`),
  "the root layout does not read the nonce out of the request",
);
assert.ok(
  /<AppearanceBootstrap nonce=\{nonce\}/.test(layout),
  "the root layout does not hand the nonce to the appearance bootstrap",
);
assert.ok(
  /<Providers nonce=\{nonce\}/.test(layout),
  "the root layout does not hand the nonce to the providers",
);

// 18. THE PRE-PAINT SCRIPT IS THE ONE THAT MUST SURVIVE, and this is the
//     assertion that says so. Without the nonce the policy refuses it, and a
//     refused pre-paint means the stylesheet's green on every load rather than
//     on one: ADR-0022 accepts one wrong paint and not a flash on every visit.
//     Proved in Chrome on 13 September 2026 against the enforcing policy, by
//     planting a property the appearance provider does not clear and finding it
//     on the root element after a load.
const bootstrap = await readFile(
  path.join(WEB, "components", "appearance-bootstrap.tsx"),
  "utf8",
);
assert.ok(
  /<Script\b[\s\S]*?\bnonce=\{nonce\}/.test(bootstrap),
  "the appearance bootstrap does not take the nonce, so the policy refuses it and every load flashes",
);

// 19. next-themes writes its own inline script to set the class before React
//     hydrates, and Next does not nonce what it did not write. Without the prop
//     the theme arrives a paint late on every load.
const providers = await readFile(path.join(WEB, "components", "providers.tsx"), "utf8");
assert.ok(
  /<ThemeProvider[\s\S]*?\bnonce=\{nonce\}/.test(providers),
  "ThemeProvider does not take the nonce, so next-themes' own script is refused",
);

console.log(
  `csp OK: ${live.split("; ").length} directives, a 128-bit nonce on all three proxy responses, 'strict-dynamic' with no inline script and no hash, 'unsafe-eval' in development only, and the nonce reaching both scripts Next did not write`,
);
