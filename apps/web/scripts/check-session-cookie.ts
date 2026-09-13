// The check the session cookie needs. Run: npm run check
//
// `COOKIE` carries the `__Host-` prefix, which is an instruction to the
// browser rather than a label. The browser refuses the cookie unless it
// arrives with `Secure`, with `Path=/`, and with no `Domain`.
//
// That turns three attributes from good practice into load-bearing. Add a
// `domain` to any set call, or drop `secure`, and the browser discards the
// cookie: the response still says `{"ok":true}`, the status is still 200, and
// nobody is signed in. There is no error anywhere to find.
//
// So this reads every place the cookie is set and holds the three conditions.
// It reads the source because a check script cannot reach Next's own
// serialiser: `next/server` does not resolve under
// `node --experimental-strip-types`, which answers ERR_MODULE_NOT_FOUND. The
// serialiser was proved once by hand instead, against the running application,
// and KPA-156 records what it answered.
//
// KPA-156.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { COOKIE } from "../../../src/auth/session.ts";

const ROOT = path.join(import.meta.dirname, "..");

/** Every route that hands the browser this cookie. */
const SETTERS = [
  path.join("app", "api", "session", "route.ts"),
  path.join("app", "(app)", "api", "account", "route.ts"),
];

// 1. The name still carries the prefix. Everything below depends on it.
assert.ok(
  COOKIE.startsWith("__Host-"),
  `COOKIE is "${COOKIE}" and no longer carries the __Host- prefix, so the ` +
    "three conditions below stopped being load-bearing",
);
assert.ok(
  !COOKIE.includes("kpa"),
  `COOKIE is "${COOKIE}" and still names KPA`,
);

// 2. Every set call meets the conditions the prefix demands.
let calls = 0;
for (const file of SETTERS) {
  const source = await readFile(path.join(ROOT, file), "utf8");

  // `cookies.set(COOKIE, <value>, { ... })`, options and all.
  const found = [
    ...source.matchAll(/cookies\.set\(\s*COOKIE\s*,[^{]*\{([^}]*)\}/g),
  ];
  assert.ok(
    found.length > 0,
    `${file} imports COOKIE and sets it nowhere this can read`,
  );

  for (const [, options = ""] of found) {
    calls += 1;
    assert.match(
      options,
      /secure:\s*true/,
      `${file} sets the cookie without secure: true, and __Host- needs it`,
    );
    assert.match(
      options,
      /path:\s*"\/"/,
      `${file} sets the cookie without path: "/", and __Host- needs it`,
    );
    assert.ok(
      !/\bdomain\s*:/.test(options),
      `${file} sets a domain on the cookie, and __Host- forbids it. The ` +
        "browser will discard the cookie and sign-in will fail silently",
    );
    // Not a `__Host-` condition, and it is the reason a stolen token cannot be
    // read by a script, so it is held here rather than nowhere.
    assert.match(
      options,
      /httpOnly:\s*true/,
      `${file} sets the cookie without httpOnly: true`,
    );
  }
}

// 3. Nothing names the cookie but the one constant. A second spelling
//    somewhere is a reader that stops matching the moment the name changes.
for (const file of SETTERS) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  assert.ok(
    !source.includes("sukkal_session"),
    `${file} spells the cookie name out instead of importing COOKIE`,
  );
}

console.log(
  `session cookie OK: ${COOKIE} on ${String(calls)} set calls, each Secure, ` +
    "Path=/, httpOnly and carrying no Domain",
);
