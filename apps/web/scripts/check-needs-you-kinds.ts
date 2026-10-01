// The check every Needs you kind map needs. Run: npm run check
//
// KPA-108 gave needs_you_kind a fifth value, credential. Two components key a
// map on `item.kind`: the card reads `KIND[item.kind]` before it reads
// `kind.icon` off the result, and the detail panel reads `NEEDS_YOU_LABEL
// [item.kind]`. A kind with no entry in either is not a wrong label, it is a
// throw the moment that kind's first row is raised, once as `undefined.icon`
// and once as a badge with no text. Node cannot import a `.tsx` file (JSX),
// so this reads each source for the one thing that must stay true: every kind
// the enum holds has an entry in both maps.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// migrations/006_needs_you.sql created the first four; 033_credential_needs_you.sql
// added the fifth. A kind added to the enum and left off this list would pass
// this check while still being missing from a map, so the list has to grow
// with the enum rather than be read back out of the maps it checks.
const KINDS = ["draft", "question", "denied-action", "deadline", "credential"];

const web = path.join(import.meta.dirname, "..");
const files = [
  path.join(web, "components", "dashboard", "needs-you.tsx"),
  path.join(web, "components", "detail-panel.tsx"),
];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const kind of KINDS) {
    const key = kind.includes("-") ? `"${kind}"` : kind;
    assert.ok(
      new RegExp(`${key}:\\s*[{"]`).test(source),
      `${path.basename(file)} carries no map entry for "${kind}"`,
    );
  }
}

console.log(`needs-you kinds OK: all ${KINDS.length} kinds have an entry in both maps`);
