// The check the connection dialog needs. Run: npm run check
//
// One rule here guards the browser. The dialog opens a tab at an address a
// person typed, so a `javascript:` address in that box would run on the page
// that opened it. The rest hold the catalogue to its own shape, because the
// dialog reads it rather than asking a question per provider.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { KEY_VARIABLE } from "../../../src/connections/crypto.ts";
import { GRANTS } from "../../../src/connections/oauth.ts";
import {
  addConnection,
  listConnections,
  removeConnection,
  setCredential,
} from "../../../src/connections/store.ts";
import { EMBEDDING } from "../../../src/embedding.ts";
import { db } from "../lib/db.ts";
import { asUrl, PROVIDERS, signInTarget, web } from "../lib/providers.ts";

// 1. Only the two web protocols reach the browser.
for (const value of [
  "https://koinon.atlassian.net",
  "http://localhost:3000",
]) {
  assert.ok(web(value), `${value} should pass`);
}
for (const value of [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "koinon.atlassian.net",
  "",
]) {
  assert.ok(!web(value), `${value} should not pass`);
}

// 2. A site typed without a scheme takes the safe one, because nobody types
//    "https://" in front of their own Jira site. One that names a scheme
//    keeps it, and a dangerous one still fails.
assert.equal(asUrl("koinon.atlassian.net"), "https://koinon.atlassian.net");
assert.equal(asUrl("  koinon.atlassian.net  "), "https://koinon.atlassian.net");
assert.equal(asUrl("http://localhost:3000"), "http://localhost:3000");
// A port is not a scheme, whatever the colon suggests.
assert.equal(asUrl("localhost:3000"), "https://localhost:3000");
assert.equal(asUrl("javascript:alert(1)"), null);
assert.equal(asUrl("javascript://evil.example"), null);
assert.equal(asUrl("data:text/html,<script>alert(1)</script>"), null);
assert.equal(asUrl(""), null);

// 3. A method that signs you in opens the site typed into it, and its own
//    address when no site was asked for.
const jira = PROVIDERS.find((entry) => entry.id === "jira")!;
const jiraOauth = jira.methods.find((method) => method.id === "oauth")!;
const jiraToken = jira.methods.find((method) => method.id === "token")!;

assert.equal(
  signInTarget(jiraOauth, { site: "https://koinon.atlassian.net" }),
  "https://koinon.atlassian.net"
);
assert.equal(
  signInTarget(jiraOauth, { site: "koinon.atlassian.net" }),
  "https://koinon.atlassian.net"
);
assert.equal(signInTarget(jiraOauth, {}), jiraOauth.signIn);

// A site that is not an address opens nothing, rather than opening the
// fallback the person did not choose.
assert.equal(signInTarget(jiraOauth, { site: "javascript:alert(1)" }), null);

// 4. A method that takes a key sends the browser nowhere, even though it asks
//    for the same site.
assert.equal(signInTarget(jiraToken, { site: "https://koinon.atlassian.net" }), null);

// 5. Every method either signs you in or asks for something. One that does
//    neither is a button that does nothing.
for (const entry of PROVIDERS) {
  assert.ok(entry.methods.length > 0, `${entry.id} offers no way in`);
  for (const method of entry.methods) {
    assert.ok(
      method.signIn || (method.fields ?? []).length > 0,
      `${entry.id}/${method.id} neither signs in nor asks for anything`
    );
    if (method.signIn) {
      assert.ok(web(method.signIn), `${entry.id}/${method.id} signs in nowhere`);
    }
    // A key is typed into a password box, so it must be marked as one.
    for (const field of method.fields ?? []) {
      assert.ok(
        field.label.length > 0 && field.placeholder.length > 0,
        `${entry.id}/${method.id}/${field.id} is unlabelled`
      );
    }
  }
}

// 6. The nine the brief names, and no tenth. Certinia PSA is a managed
//    package inside Salesforce, so one grant reaches it and it sits in the
//    service list rather than in the catalogue.
assert.equal(PROVIDERS.length, 9, "the brief names nine providers");
const salesforce = PROVIDERS.find((entry) => entry.id === "salesforce")!;
assert.ok(salesforce, "Salesforce is missing");
assert.ok(
  salesforce.services.some((service) => service.label === "Certinia PSA"),
  "Certinia PSA is not a Salesforce service"
);
assert.ok(
  !PROVIDERS.some((entry) => entry.name.toLowerCase().includes("certinia")),
  "Certinia is a Salesforce service, not a provider of its own"
);

// 6b. The grant flag on a card and the record behind it say the same thing.
//
//     `providers.ts` carries a boolean because a client component bundles it
//     and reaching into `src/` would carry `node:crypto` into the browser. So
//     the two are separate, and this is what stops them drifting: a card
//     promising a grant Sukkal cannot run is a button that fails on press, and a
//     record nobody can reach is code nothing calls.
const granted = new Set(
  PROVIDERS.filter((entry) => entry.methods.some((method) => method.grant)).map(
    (entry) => entry.id
  )
);
assert.deepEqual(
  [...granted].sort(),
  Object.keys(GRANTS).sort(),
  "a card and src/connections/oauth.ts disagree about which providers Sukkal can grant"
);

// Every service on a card Sukkal grants has an answer in the record, even when
// the answer is no scope at all. A card gaining a service otherwise grants
// nothing for it and says nothing about why.
for (const id of granted) {
  const card = PROVIDERS.find((entry) => entry.id === id)!;
  const grant = GRANTS[id]!;
  for (const service of card.services) {
    assert.ok(
      service.id in grant.scopesByService,
      `${id} offers ${service.id} and the grant record does not answer for it`
    );
  }
  for (const service of Object.keys(grant.scopesByService)) {
    assert.ok(
      card.services.some((offered) => offered.id === service),
      `the grant record answers for ${id}'s ${service}, which no card offers`
    );
  }
  // The address is asked for on every grant. It is what tells three accounts
  // on one provider apart, so a record without it produces one connection
  // nobody can name.
  assert.ok(
    grant.baseScopes.some((scope) => scope.includes("userinfo.email")),
    `${id} asks for no address, so its accounts cannot be told apart`
  );
}

// 7. Voyage names the model and the width src/embedding.ts pins, so a
//    migration that changes either one fails here rather than leaving the
//    screen quoting the old pair.
const voyage = PROVIDERS.find((entry) => entry.id === "voyage")!;
assert.ok(voyage, "Voyage AI is missing");
assert.equal(voyage.methods.length, 1, "Voyage offers one way in");
const voyageKey = voyage.methods[0];
assert.equal(voyageKey.id, "key", "Voyage takes an API key");
for (const copy of [voyage.blurb, voyageKey.hint]) {
  assert.ok(copy.includes(EMBEDDING.model), `${copy} does not name the model`);
  assert.ok(
    copy.includes(String(EMBEDDING.dimension)),
    `${copy} does not name the width`
  );
}

// 8. Atlassian expires an API token, so the copy says so and the form asks
//    for the date. A credential nobody can date is a credential nobody
//    renews.
assert.ok(
  !/never expires/i.test(jiraToken.hint),
  "the Jira token hint still calls the token a password that never expires"
);
assert.ok(
  /expire/i.test(jiraToken.hint),
  "the Jira token hint does not say the token expires"
);
assert.ok(
  (jiraToken.fields ?? []).some((field) => field.kind === "date"),
  "the Jira token form does not ask when the token runs out"
);

console.log(
  "connections OK: nine providers, only web addresses open, a key opens nothing, " +
    `Voyage names ${EMBEDDING.model} at ${EMBEDDING.dimension}, and the Jira token is dated`
);

// ══ The same claims, against the rows ═══════════════════════════════════════

// KPA-127 moved the list off the browser, so the catalogue above is no longer
// the whole answer: a stored connection names a provider and a method, and a
// stored credential is what the screen must never read back. Three claims run
// here, and each one is silent when it breaks.
//
// The read narrows. `listConnections` names its columns, so its answer holds
// the ten fields below and no secret.
//
// The plaintext is nowhere in the answer. Searching the serialised read for
// the secret itself catches a column carrying it under another name, which
// asserting the absence of `ciphertext` would not.
//
// Every stored row names a provider this build offers. A row naming a tenth
// provider draws no card at all, because `ConnectionCard` returns null.
//
// This half skips when `DATABASE_URL_TEST` is unset, which is how CI runs it
// and how it runs beside a box that is switched off:
//
//   DATABASE_URL_TEST=postgresql://you@localhost:5432/sukkal_dev_b \
//     node --experimental-strip-types scripts/check-connections.ts

const url = process.env["DATABASE_URL_TEST"];
if (!url) {
  console.log("connection rows SKIPPED: DATABASE_URL_TEST is unset");
  process.exit(0);
}

// `lib/db.ts` is the one place the web tier opens a pool, and the one place the
// date parser is set on this package's copy of the driver.
process.env["DATABASE_URL"] = url;

// A key made here and thrown away, so this runs on a box that holds none. No
// key ever enters this repository: docs/runbooks/secrets.md says why.
const heldKey = process.env[KEY_VARIABLE];
process.env[KEY_VARIABLE] = randomBytes(32).toString("base64");

const pool = db();
const client = await pool.connect();
const SECRET = "sk-or-v1-a-key-shaped-string";

/** The ten fields a screen may see. The sealed bytes are not among them. */
const SEEN = [
  "expiresOn",
  "hasSecret",
  "id",
  "issuedOn",
  "method",
  "name",
  "provider",
  "services",
  "verdict",
  "verifiedOn",
];

let added: string | null = null;
try {
  // 9. A connection made and a key sealed against it, which is the round trip
  //    the dialog now makes.
  added = await addConnection(client, {
    provider: "openrouter",
    name: "check-connections",
    method: "key",
  });
  await setCredential(client, added, SECRET, { expiresOn: "2027-01-31" });

  const list = await listConnections(client);
  const made = list.find((one) => one.id === added);
  assert.ok(made, "the connection did not come back");
  assert.deepEqual(
    Object.keys(made).sort(),
    SEEN,
    "listConnections answers with a key nobody asked for",
  );
  assert.equal(made.hasSecret, true, "a stored key read as no key");
  // A calendar date comes back as text, not as a Date at local midnight.
  assert.equal(made.expiresOn, "2027-01-31");

  // 10. The whole answer, searched for the secret itself.
  assert.ok(
    !JSON.stringify(list).includes(SECRET),
    "the read carried the plaintext",
  );

  // 11. Every stored row draws a card, which needs a provider and a method
  //     this build offers.
  for (const one of list) {
    const entry = PROVIDERS.find((provider) => provider.id === one.provider);
    assert.ok(entry, `connection ${one.id} names provider ${one.provider}`);
    assert.ok(
      entry.methods.some((method) => method.id === one.method),
      `${one.provider} offers no method ${one.method}`,
    );
    for (const service of one.services) {
      assert.ok(
        entry.services.some((offered) => offered.id === service),
        `${one.provider} offers no service ${service}`,
      );
    }
  }

  console.log(
    `connection rows OK: ${list.length} read, ten fields each, and no secret among them`,
  );
} finally {
  if (added) await removeConnection(client, added);
  client.release();
  await pool.end();
  if (heldKey === undefined) delete process.env[KEY_VARIABLE];
  else process.env[KEY_VARIABLE] = heldKey;
}
