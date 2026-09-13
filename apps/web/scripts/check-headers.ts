// The check the response headers need. Run: npm run check
//
// A security header is a line of config, so nothing fails when it goes. The
// application serves every page exactly as before and the property is simply
// absent, which is the shape of defect nobody notices until somebody looks.
//
// KPA-103. `Referrer-Policy` landed because an address reached a URL, and a
// URL reaches the `Referer` header on any cross-origin request the page makes.
// This is what keeps the header there. KPA-146 added nosniff and a frame policy.

import assert from "node:assert/strict";

import config from "../next.config.ts";

const declared = await config.headers?.();
assert.ok(declared, "next.config.ts declares no headers at all");

// 1. Every path, rather than a list somebody has to extend. A header on the
//    pages nobody thought of is the point of it.
const everywhere = declared.filter((rule) => rule.source === "/:path*");
assert.equal(
  everywhere.length,
  1,
  "no rule covers every path, so a page added next month carries nothing",
);

const carried = new Map(
  everywhere.flatMap((rule) => rule.headers.map((one) => [one.key, one.value])),
);

// 2. The policy itself. `same-origin` sends the whole address within this
//    installation, where the browser already holds it, and sends nothing at
//    all to another origin, which is the leak.
assert.equal(
  carried.get("Referrer-Policy"),
  "same-origin",
  "Referrer-Policy is missing or has been changed",
);

// 3. Two values that would read as stronger and are not, so a later edit
//    toward either one fails here and reads why.
//
//    `no-referrer` also sets `Origin` to null on an HTML form submission and
//    on a fetch in same-origin or no-cors mode, which would quietly defeat a
//    CSRF check that reads it. `strict-origin-when-cross-origin` is the
//    browser default, so declaring it changes nothing and still sends this
//    installation's origin to every other one.
for (const weaker of ["no-referrer", "strict-origin-when-cross-origin"]) {
  assert.notEqual(
    carried.get("Referrer-Policy"),
    weaker,
    `Referrer-Policy is ${weaker}. next.config.ts says why same-origin is the choice`,
  );
}

// 4. KPA-146. `nosniff` is the only value the header has, so anything else is
//    a typo the browser ignores, and a stored file can run as script again.
assert.equal(
  carried.get("X-Content-Type-Options"),
  "nosniff",
  "X-Content-Type-Options is missing or has been changed",
);

// 5. KPA-146. `DENY` rather than `SAMEORIGIN`, because no screen frames
//    another. `frame-ancestors` in the Content-Security-Policy replaces this,
//    and KPA-148 removes the assertion when it does.
assert.equal(
  carried.get("X-Frame-Options"),
  "DENY",
  "X-Frame-Options is missing or has been changed, so another site can frame the sign-in page",
);

console.log(
  "headers OK: every path carries Referrer-Policy: same-origin, X-Content-Type-Options: nosniff and X-Frame-Options: DENY",
);
