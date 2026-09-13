// The check the KPA-155 storage rename needs. Run: npm run check
//
// KPA-153 moved every machine name off KPA and left the browser alone, because
// renaming a storage key abandons a saved choice rather than moving it. KPA-155
// renames them and carries each value forward, and this is what says so.
//
// A FAILURE HERE IS SILENT IN THE BROWSER. Nothing throws, no request fails,
// and the reader simply finds their board ungrouped, their hidden columns back,
// and their dragged order gone. Nine keys, each holding a preference somebody
// set by hand. ADR-0022 lists every key and says which side of the wall it is
// on.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RESOLVED_KEY } from "../lib/appearance.ts";
import {
  createLocalStore,
  formerKey,
  readCarried,
  type KeyStore,
} from "../lib/local-store.ts";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Stub extends KeyStore {
  held: Record<string, string>;
}

/** A browser's storage, and nothing else. */
function stub(start: Record<string, string>): Stub {
  const held: Record<string, string> = { ...start };
  return {
    held,
    getItem: (key) => held[key] ?? null,
    setItem: (key, value) => {
      held[key] = value;
    },
    removeItem: (key) => {
      Reflect.deleteProperty(held, key);
    },
  };
}

/** Every key a `createLocalStore` call names, read from the source itself. */
function keysIn(file: string): string[] {
  const source = readFileSync(path.join(WEB, file), "utf8");
  return [...source.matchAll(/createLocalStore<[^>]+>\(\s*\n?\s*"([^"]+)"/g)].map(
    (found) => found[1]!,
  );
}

// 1. The nine keys that carry a value are the nine the source names. Reading
//    them from the source rather than listing them here is what makes a tenth
//    key added later fail this check instead of passing it in silence.
const carried = [
  ...keysIn("components/issues/issue-list.tsx"),
  ...keysIn("lib/space-context.tsx"),
].sort();

assert.deepEqual(
  carried,
  [
    "sukkal.issues.arranged",
    "sukkal.issues.group",
    "sukkal.issues.grouporder",
    "sukkal.issues.groupsort",
    "sukkal.issues.hidden",
    "sukkal.issues.sort",
    "sukkal.issues.subgroup",
    "sukkal.issues.tree",
    "sukkal.space",
  ],
  "the store keys are no longer the nine KPA-155 renamed",
);

// 2. A browser used before the rename keeps every one of those preferences.
//    None of these values is the key's fallback, because a rule that returned
//    the fallback would pass a check whose expected value was one.
const SAVED: Record<string, string> = {
  "kpa.issues.arranged": '{"status":["done","doing"]}',
  "kpa.issues.group": "assignee",
  "kpa.issues.grouporder": "manual",
  "kpa.issues.groupsort": "count",
  "kpa.issues.hidden": "sprint,updated",
  "kpa.issues.sort": "priority",
  "kpa.issues.subgroup": "priority",
  "kpa.issues.tree": "off",
  "kpa.space": "collibra",
};

for (const key of carried) {
  const former = formerKey(key);
  const want = SAVED[former];
  assert.ok(want, `${key} has no pre-rename value to carry, so nothing is proved`);

  const storage = stub({ [former]: want });
  assert.equal(readCarried(storage, key), want, `${key} lost what ${former} held`);

  // 3. It moved rather than being copied. A value read and not written forward
  //    passes the line above and is gone by the next read.
  assert.equal(storage.held[key], want, `${key} was read from ${former} and never written`);
  assert.equal(storage.held[former], undefined, `${former} survived the move`);

  // 4. The second read needs no former key at all, so the move runs once.
  assert.equal(readCarried(storage, key), want, `${key} did not hold after the move`);
}

// 5. A stale former key never overwrites a newer value. This is the one way a
//    migration like this loses work: somebody changes the preference after the
//    rename, and a later read finds the old key and puts the old value back.
for (const key of carried) {
  const former = formerKey(key);
  const storage = stub({ [key]: "own", [former]: SAVED[former]! });
  assert.equal(readCarried(storage, key), "own", `${former} overwrote ${key}`);
  assert.equal(storage.held[former], SAVED[former], `${key} touched ${former} for nothing`);
}

// 6. A browser holding neither key reads nothing, so the store falls back
//    exactly as it did before the rename.
for (const key of carried) {
  const storage = stub({});
  assert.equal(readCarried(storage, key), null, `${key} invented a value`);
  assert.deepEqual(storage.held, {}, `${key} wrote into an empty browser`);
}

// 6b. THE STORE ITSELF CARRIES THE VALUE, which the five cases above do not
//     say. They exercise the rule directly, so a `createLocalStore` that never
//     called it would pass every one of them and lose every preference. This
//     builds a real store over a stub browser and reads through it.
//
//     `read` is the store's own snapshot function, so what it answers here is
//     what a render sees.
const browser = stub({ "kpa.issues.group": "assignee" });
const wasWindow = Reflect.get(globalThis, "window");
Reflect.set(globalThis, "window", { localStorage: browser });
try {
  const store = createLocalStore<string>("sukkal.issues.group", "status", () => true);
  assert.equal(store.read(), "assignee", "the store did not carry the former key forward");
  assert.equal(browser.held["sukkal.issues.group"], "assignee", "the store read but never wrote");
  assert.equal(browser.held["kpa.issues.group"], undefined, "the store left the former key");

  // A browser holding neither key still gets the fallback through the store.
  const empty = stub({});
  Reflect.set(globalThis, "window", { localStorage: empty });
  const fresh = createLocalStore<string>("sukkal.issues.group", "status", () => true);
  assert.equal(fresh.read(), "status", "an empty browser did not get the fallback");
} finally {
  if (wasWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else Reflect.set(globalThis, "window", wasWindow);
}

// 7. The rule claims a former name only for a key that took the new prefix.
//    `theme` belongs to next-themes and never carried one, so the rule reads it
//    and does nothing else to it.
assert.equal(formerKey("theme"), "theme", "the rule claimed a former name for theme");
const themed = stub({ theme: "dark" });
assert.equal(readCarried(themed, "theme"), "dark", "the rule lost the theme");
assert.deepEqual(themed.held, { theme: "dark" }, "the rule rewrote the theme");

// 8. The appearance cache renamed and carries nothing, which ADR-0022 allows
//    because it caches a server value. The pre-paint script names one key and
//    never the former one, which is the getItem KPA-155 refused to add.
assert.equal(RESOLVED_KEY, "sukkal.appearance", "the appearance cache did not rename");

const bootstrap = readFileSync(
  path.join(WEB, "components", "appearance-bootstrap.tsx"),
  "utf8",
);
const script = /const SCRIPT = `([\s\S]*?)`;/.exec(bootstrap);
assert.ok(script, "the pre-paint script is no longer a template literal");
assert.ok(
  !script[1]!.includes("kpa."),
  "the pre-paint script reads a former key, which is the getItem KPA-155 refused",
);

// 9. No live key under components or lib still reads `kpa.`. Comments are
//    stripped first, because the prose has to name the former prefix to explain
//    the rule. `local-store.ts` is left out of this list for the same reason in
//    code: the one expression that builds a former name is the rule itself.
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
}

const NAMING_FILES = [
  "components/issues/issue-list.tsx",
  "components/appearance-bootstrap.tsx",
  "components/appearance-provider.tsx",
  "components/setup/setup-wizard.tsx",
  "lib/appearance.ts",
  "lib/space-context.tsx",
];

for (const file of NAMING_FILES) {
  const code = codeOf(readFileSync(path.join(WEB, file), "utf8"));
  assert.ok(!code.includes("kpa."), `${file} still names a kpa. key in code`);
  assert.ok(!code.includes("kpa-"), `${file} still names a kpa- id in code`);
}

// 10. The dragged order is read in one place. Before KPA-155 `issue-list.tsx`
//     named that key three times, once for the store and twice for a direct
//     read beside it, so a migration covering the store alone would have missed
//     two callers and handed them `{}`.
const list = readFileSync(path.join(WEB, "components", "issues", "issue-list.tsx"), "utf8");
assert.equal(
  list.split('"sukkal.issues.arranged"').length - 1,
  1,
  "the arranged key is named more than once, so a read bypasses the store",
);
assert.ok(
  !list.includes("localStorage"),
  "issue-list.tsx reaches localStorage directly, so it bypasses the store",
);

console.log(
  `local store OK: ${carried.length} keys carry their value off kpa., the former key goes as it moves, and the appearance cache renames without one`,
);
