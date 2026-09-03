// The check the owner's row needs. Run: npm run check
//
// KPA-126 moves the account and the chosen colours out of localStorage. Four
// claims carry that move, and three of them are silent when they break.
//
// The validator. `isSelection` is what stands between a request body and the
// column, and between a stored preset and a screen. It admits four fields and
// a preset id this build offers, and nothing else.
//
// The round trip. What the wizard writes has to be what the layout reads.
//
// The hash never leaves. `readAccount` names its columns, and `password_hash`
// is not among them, so this asserts the exact key set rather than the absence
// of one name.
//
// The first paint. The pre-paint script must read only this browser. A device
// with no cached blob paints the stylesheet's own colour once and sets no
// property, which is the flash ADR-0022 accepts; a device with one paints the
// saved colour before React runs, which is the flash it prevents. This runs the
// shipped string rather than a copy of it.
//
// The database half skips when `DATABASE_URL_TEST` is unset, which is how CI
// runs it and how it runs beside a box that is switched off:
//
//   DATABASE_URL_TEST=postgresql://you@localhost:5432/kpa_dev_b \
//     node --experimental-strip-types scripts/check-account.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import {
  DEFAULT_SELECTION,
  RESOLVED_KEY,
  isSelection,
  resolveAppearance,
} from "../lib/appearance.ts";
import { db } from "../lib/db.ts";
import { initialsOf } from "../lib/initials.ts";
import {
  readAccount,
  readAppearance,
  writeAccount,
  writeAppearance,
} from "../lib/owner.ts";

const WEB = path.join(import.meta.dirname, "..");

// ══ The initials ════════════════════════════════════════════════════════════
//
// KPA-144. The sidebar drew `SD` from a constant until the account row
// answered for it, so these letters are now derived on every installation and
// a name shape nobody anticipated has to produce something a font can draw.

for (const [name, expected] of [
  ["Shane Dolley", "SD"],
  // One word is one letter, which is what a person with one name gets
  // everywhere else.
  ["Ada", "A"],
  ["shane dolley", "SD"],
  // The middle name is skipped: the first and the last are what a person is
  // called, and three letters do not fit the circle.
  ["Mary Jane Watson", "MW"],
  ["  Shane   Dolley  ", "SD"],
  ["O'Brien", "O"],
  // A letter outside the basic plane is two code units. Indexing would cut it
  // in half and draw a glyph no font has.
  ["Ünal Çöl", "ÜÇ"],
  ["日向 翔陽", "日翔"],
] as const) {
  assert.equal(initialsOf(name), expected, `"${name}" gave the wrong initials`);
}

// Nothing usable still draws something. An avatar with no glyph reads as a
// rendering fault rather than as a box nobody has named.
for (const nothing of ["", "   ", "\t\n"]) {
  assert.equal(initialsOf(nothing), "?", "an empty name drew nothing");
}

console.log(
  "initials OK: two names give two letters, one gives one, and nothing gives a question mark",
);

// ══ The validator ═══════════════════════════════════════════════════════════

assert.ok(isSelection(DEFAULT_SELECTION), "the default is not a selection");
assert.ok(
  isSelection({
    accentId: "custom",
    chartsId: "custom",
    accentHex: "#0D6B45",
    chartsHex: "#ff0000",
  }),
  "the custom preset and an upper-case hex were refused",
);

for (const [what, wrong] of [
  ["null", null],
  ["an array", ["green"]],
  ["a string", "green"],
  ["an unknown accent", { ...DEFAULT_SELECTION, accentId: "puce" }],
  ["an unknown palette", { ...DEFAULT_SELECTION, chartsId: "puce" }],
  ["three digits of hex", { ...DEFAULT_SELECTION, accentHex: "#0d6" }],
  ["a colour name", { ...DEFAULT_SELECTION, chartsHex: "rebeccapurple" }],
  ["a missing field", { accentId: "green", chartsId: "greens" }],
] as [string, unknown][]) {
  assert.ok(!isSelection(wrong), `${what} was admitted as a selection`);
}

console.log("appearance validator OK: four fields, and a preset this build has");

// ══ The first paint ═════════════════════════════════════════════════════════

/**
 * The pre-paint script, read out of the component that ships it.
 *
 * The component is JSX, which node cannot load, so the string is lifted from
 * the file as text. Only the key name is interpolated into it, and this puts
 * back the same value the module exports, so what runs below is what the
 * browser runs.
 */
function prePaintScript(): string {
  const source = readFileSync(
    path.join(WEB, "components", "appearance-bootstrap.tsx"),
    "utf8",
  );
  const between = /const SCRIPT = `([\s\S]*?)`;/.exec(source);
  assert.ok(between, "the pre-paint script is no longer a template literal");
  return between[1]!.replace(
    "${JSON.stringify(RESOLVED_KEY)}",
    JSON.stringify(RESOLVED_KEY),
  );
}

/** What the script set on the root element, given what the browser held. */
function paint(saved: Record<string, string> | null, theme: string) {
  const set: Record<string, string> = {};
  const store: Record<string, string> = { theme };
  if (saved) store[RESOLVED_KEY] = JSON.stringify(saved);

  runInNewContext(prePaintScript(), {
    localStorage: { getItem: (key: string) => store[key] ?? null },
    document: { documentElement: { style: { setProperty: (key: string, value: string) => { set[key] = value; } } } },
    window: { matchMedia: () => ({ matches: false }) },
    JSON,
    Object,
  });
  return set;
}

const resolved = resolveAppearance({ ...DEFAULT_SELECTION, accentId: "violet" });

// 1. A second device, on its very first load. It has never painted these
//    colours, so it holds no blob, and the script sets nothing at all. The
//    stylesheet's own green shows, the read lands, and the colour is right from
//    the second load. This is the one wrong paint ADR-0022 accepts.
assert.deepEqual(paint(null, "light"), {}, "a device with no cache painted something");

// 2. Every load after that. The blob is there and the colour is applied before
//    React runs, which is the flash the script exists to prevent.
assert.deepEqual(paint(resolved, "light"), resolved.light);
assert.deepEqual(paint(resolved, "dark"), resolved.dark);

// 3. No network read reached the paint path. The script names one storage key
//    and the theme, and it calls nothing else. A `fetch` here would be a round
//    trip in front of the first paint, which is the whole reason
//    `kpa.appearance` stayed in the browser.
const script = prePaintScript();
for (const reach of ["fetch", "XMLHttpRequest", "/api/"]) {
  assert.ok(!script.includes(reach), `the pre-paint script reaches ${reach}`);
}

console.log("first paint OK: no cache paints nothing, a cache paints the saved colour");

// ══ The same claims, against the store ══════════════════════════════════════

const url = process.env["DATABASE_URL_TEST"];
if (!url) {
  console.log("account writes SKIPPED: DATABASE_URL_TEST is unset");
  process.exit(0);
}

// `lib/db.ts` is the one place the web tier opens a pool, and the one place the
// date parser is set on this package's copy of the driver. Pointing it at the
// test database is what lets this check use it rather than open a second pool.
process.env["DATABASE_URL"] = url;
const pool = db();

/** The row as it was found, put back however this check ends. */
const held = await pool.query<Record<string, unknown>>(
  `SELECT name, email, assistant_name, password_hash, created_at, appearance
     FROM users WHERE id = 1`,
);
const before = held.rows[0]!;

async function restore(): Promise<void> {
  await pool.query(
    `UPDATE users
        SET name = $1, email = $2, assistant_name = $3, password_hash = $4,
            created_at = $5, appearance = $6
      WHERE id = 1`,
    [
      before["name"],
      before["email"],
      before["assistant_name"],
      before["password_hash"],
      before["created_at"],
      before["appearance"],
    ],
  );
}

try {
  // 4. A box nobody has set up reads as no account, which is what sends
  //    somebody to the wizard.
  await pool.query(
    `UPDATE users SET email = NULL, assistant_name = NULL, password_hash = NULL,
                      created_at = NULL, appearance = NULL WHERE id = 1`,
  );
  assert.equal(await readAccount(pool), null, "an unset box read as configured");
  assert.equal(await readAppearance(pool), null, "an unset box read as coloured");

  // 5. The wizard's write, read back through the layout's read. All four
  //    account columns go in one statement, which is what
  //    `users_the_account_is_whole` requires.
  const HASH = "$scrypt$ln=17,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA$a2V5";
  await writeAccount(pool, {
    name: "Shane Dolley",
    email: "Shane@Koinon.com.au",
    assistant: "Kestrel",
    passwordHash: HASH,
  });

  const account = await readAccount(pool);
  assert.ok(account, "the account did not come back");
  assert.equal(account.name, "Shane Dolley");
  assert.equal(account.email, "Shane@Koinon.com.au");
  assert.equal(account.assistant, "Kestrel");
  assert.match(account.created, /^\d{4}-\d{2}-\d{2}T/, "created is not an ISO timestamp");

  // 6. Four keys, and the hash is not one of them. This is the assertion the
  //    route relies on: whatever it answers with comes from here.
  assert.deepEqual(
    Object.keys(account).sort(),
    ["assistant", "created", "email", "name"],
    "readAccount answers with a key nobody asked for",
  );

  // 7. The hash is in the row all the same, so the read narrows rather than the
  //    write omitting it.
  const stored = await pool.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = 1",
  );
  assert.equal(stored.rows[0]?.password_hash, HASH);

  // 8. The colours round-trip, and a preset this build no longer offers reads
  //    as no choice rather than as a colour nothing can paint.
  const chosen = { ...DEFAULT_SELECTION, accentId: "violet", chartsId: "ocean" };
  await writeAppearance(pool, chosen);
  assert.deepEqual(await readAppearance(pool), chosen);

  await pool.query("UPDATE users SET appearance = $1 WHERE id = 1", [
    { ...chosen, accentId: "puce" },
  ]);
  assert.equal(
    await readAppearance(pool),
    null,
    "a preset this build dropped came back as a selection",
  );

  console.log("account store OK: it round-trips, and no read carries the hash");
} finally {
  await restore();
  await pool.end();
}
