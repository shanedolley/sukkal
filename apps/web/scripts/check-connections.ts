// The check the connection dialog needs. Run: npm run check
//
// One rule here guards the browser. The dialog opens a tab at an address a
// person typed, so a `javascript:` address in that box would run on the page
// that opened it. The rest hold the catalogue to its own shape, because the
// dialog reads it rather than asking a question per provider.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { KEY_VARIABLE } from "../../../src/connections/crypto.ts";
import { GRANTS } from "../../../src/connections/oauth.ts";
import { probeFor } from "../../../src/connections/verify.ts";
import {
  addConnection,
  listConnections,
  removeConnection,
  setCredential,
} from "../../../src/connections/store.ts";
import { EMBEDDING } from "../../../src/embedding.ts";
import { db } from "../lib/db.ts";
import { createRemoteStore, send } from "../lib/remote-store.ts";
import {
  asUrl,
  initialValues,
  isEmail,
  type Method,
  needsSendFrom,
  PROVIDERS,
  refusedMethod,
  signInTarget,
  web,
} from "../lib/providers.ts";

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
// A pasted API token is not a host. It once opened a tab at the token.
assert.equal(asUrl("ATATT3xFAKE=00000000"), null);
// A host with no dot is no site, localhost apart.
assert.equal(asUrl("intranet"), null);
assert.equal(asUrl("localhost"), "https://localhost");

// 3. A method that signs you in opens the site typed into it, and its own
//    address when no site was asked for.
//    No provider ships a method that does both now, so the method is built
//    here.
const jira = PROVIDERS.find((entry) => entry.id === "jira")!;
const jiraToken = jira.methods.find((method) => method.id === "token")!;
const siteSignIn: Method = {
  id: "oauth",
  label: "OAuth",
  hint: "",
  signIn: "https://id.atlassian.com/login",
  fields: [{ id: "site", label: "Site", placeholder: "", kind: "url" }],
};

assert.equal(
  signInTarget(siteSignIn, { site: "https://koinon.atlassian.net" }),
  "https://koinon.atlassian.net"
);
assert.equal(
  signInTarget(siteSignIn, { site: "koinon.atlassian.net" }),
  "https://koinon.atlassian.net"
);
assert.equal(signInTarget(siteSignIn, {}), siteSignIn.signIn);

// A site that is not an address opens nothing, rather than opening the
// fallback the person did not choose.
assert.equal(signInTarget(siteSignIn, { site: "javascript:alert(1)" }), null);
assert.equal(signInTarget(siteSignIn, { site: "ATATT3xFAKE=00000000" }), null);

// 4. A method that takes a key sends the browser nowhere, even though it asks
//    for the same site.
assert.equal(signInTarget(jiraToken, { site: "https://koinon.atlassian.net" }), null);

// Jira connects by API token alone, in the catalogue and at the route.
assert.deepEqual(jira.methods.map((method) => method.id), ["token"]);
assert.equal(refusedMethod("jira", "oauth"), "Jira connects by API token.");
assert.equal(refusedMethod("jira", "token"), null);
assert.equal(refusedMethod("linear", "oauth"), null);

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

// 6. The nine the brief names, and Resend, which KPA-143 added as the sender
//    of the password reset link. Certinia PSA is a managed package inside
//    Salesforce, so one grant reaches it and it sits in the service list
//    rather than in the catalogue.
assert.equal(PROVIDERS.length, 10, "the brief names nine providers, and KPA-143 added Resend");
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

// 9. Resend is the sender, so the card takes a key and the probe behind it
//    costs nothing. A metered probe would be skipped by the hourly recheck,
//    which is the whole reason the key is verifiable at all.
//
//    THE HINT ASKS FOR A SEND-ONLY KEY, and it must keep asking. Sukkal calls
//    one Resend endpoint ever, `POST /emails`, which `sending_access` permits.
//    An earlier hint asked for full access so the probe could list the keys,
//    and Shane ruled on 30 September 2026 that a health indicator is not worth
//    the blast radius of the whole account. `src/connections/verify.ts` reads
//    the refusal as proof of life instead.
const resend = PROVIDERS.find((entry) => entry.id === "resend")!;
assert.ok(resend, "Resend is missing");
assert.equal(resend.methods.length, 1, "Resend offers one way in");
const resendKey = resend.methods[0];
assert.equal(resendKey.id, "key", "Resend takes an API key");
assert.match(
  resendKey.hint,
  /sending access only/i,
  "the Resend hint does not ask for a send-only key, which is the least privilege that sends"
);
assert.doesNotMatch(
  resendKey.hint,
  /full access/i,
  "the Resend hint asks for full access again, which trades the account for a health check"
);
// 9b. The address has its own box, and the hint stops asking for it in the
//     name. KPA-143 read the `from` off the card's name and KPA-158 separated
//     the two, because the Name box asks what tells one account from the next
//     and Shane answered that question: "Sukkal Resend", which Resend refuses
//     as an address. The form must not disagree with itself again.
const sendFrom = (resendKey.fields ?? []).find((field) => field.kind === "email");
assert.ok(sendFrom, "Resend asks for no Send from address, so the mail has no from");
assert.equal(sendFrom.id, "sendFrom", "the route reads the address under sendFrom");
assert.ok(
  isEmail(sendFrom.placeholder),
  "the Send from placeholder does not show an address"
);
// ponytail: the default is this installation's verified domain. The check is
// that there is one and that it is an address, not which one it is.
assert.ok(
  isEmail(initialValues(resendKey)["sendFrom"] ?? ""),
  "the Send from box starts empty, so every install types the same address"
);
assert.doesNotMatch(
  resendKey.hint,
  /name this card with the address/i,
  "the Resend hint asks for the address in the name box again, which is what broke"
);
assert.match(
  resendKey.hint,
  /Send from/,
  "the Resend hint does not say where the address goes"
);
// The rule the route applies, read off the catalogue rather than from a
// provider named in a handler. Resend sends and no other provider does.
assert.ok(needsSendFrom("resend"), "a Resend card may be saved with no address");
for (const entry of PROVIDERS) {
  if (entry.id === "resend") continue;
  assert.ok(
    !needsSendFrom(entry.id),
    `${entry.id} gained a required Send from address, and it sends no mail`
  );
}

// 9c. What the route and the dialog both call an address. The route is the
//     trust boundary, so this holds the one function both of them use.
for (const good of ["no-reply@sukkal.app", "shane@koinon.com.au", "a.b+c@d.e.f"]) {
  assert.ok(isEmail(good), `${good} should read as an address`);
}
for (const bad of [
  "Sukkal Resend",
  "",
  "no-reply@sukkal",
  "no reply@sukkal.app",
  // The header injection the name must never carry either. `fromHeader` in
  // src/auth/reset.ts refuses it on the name's side.
  "no-reply@sukkal.app\r\nBcc: them@example.com",
  '"a"@b.c',
  "a@b.c>",
  "a,b@c.de",
]) {
  assert.ok(!isEmail(bad), `${JSON.stringify(bad)} should not read as an address`);
}
const resendProbe = probeFor("resend", "re_a-key-shaped-string");
assert.ok(resendProbe, "Resend names no probe, so the hourly recheck skips its key");
assert.equal(
  resendProbe.cost,
  "free",
  "the Resend probe is metered, so the hourly recheck would skip it"
);

// 9d. The dialog says the name is public, and sends the address.
//
//     The form disagreeing with itself is what KPA-158 closes, so the Name
//     box's own help text has to say the name travels with the mail. The source
//     is read rather than imported: node strips types and leaves JSX alone, so
//     importing a .tsx answers ERR_UNKNOWN_FILE_EXTENSION. Each pattern below
//     is a string only the new code could produce.
const dialog = await readFile(
  path.join(import.meta.dirname, "..", "components", "connections", "connections.tsx"),
  "utf8"
);
assert.match(
  dialog,
  /the name recipients see beside the address/,
  "the Name box does not say the name appears in the mail recipients read"
);
assert.match(
  dialog,
  /placeholder=\{sends \? "Sukkal Resend"/,
  "the Name box still offers a label-shaped placeholder on a card that sends mail"
);
assert.match(
  dialog,
  /sendFrom: from \? \(value\(from\.id\) \|\| null\) : null/,
  "the dialog collects the Send from address and posts none of it"
);

// 9b. A refused add keeps the dialog open and says why. KPA-105. A mistyped
//     Jira site, a second connection to one, and a bad email are all 400s the
//     route answers with a sentence, and the dialog closed on every one of
//     them without showing it. `send` already returns the message; the fault
//     was `addConnection` throwing the answer away.
const realFetch = globalThis.fetch;
const realError = console.error;
try {
  globalThis.fetch = (async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(JSON.stringify({ error: "That site already has a connection." }), {
          status: 400,
        })
      : new Response("[]", { status: 200 })) as unknown as typeof fetch;
  console.error = () => {};
  assert.equal(
    await send(createRemoteStore("/api/connections", []), "/api/connections", "POST", {}),
    "That site already has a connection.",
    "a refused write did not answer with the server's sentence"
  );
} finally {
  globalThis.fetch = realFetch;
  console.error = realError;
}
// `lib/connections.ts` imports `./remote-store` without its extension, as the
// web tier does under `bundler`, so node cannot load it. Its source is read.
const screenStore = await readFile(path.join(import.meta.dirname, "..", "lib", "connections.ts"), "utf8");
assert.match(
  screenStore,
  /export function addConnection\(connection: NewConnection\): Promise<string \| null> \{\s+return send\(/,
  "addConnection throws the server's answer away"
);
assert.match(
  dialog,
  /const said = await addConnection\(connection\);\s+if \(said === null\) close\(\);/,
  "the dialog closes whether or not the server took the connection"
);
console.log("refused add OK: the server's sentence reaches the dialog, which stays open");

// 10. Every card draws a mark. `BrandMark` returns null for an id it holds
//     none for, so a tenth provider added without one draws an empty tile and
//     nothing says so. The source is read rather than imported: node strips
//     types and leaves JSX alone, so importing a .tsx answers
//     ERR_UNKNOWN_FILE_EXTENSION.
const brands = await readFile(
  path.join(import.meta.dirname, "..", "components", "ui", "svgs", "brands.tsx"),
  "utf8"
);
for (const entry of PROVIDERS) {
  assert.match(
    brands,
    new RegExp(`^\\s{2}${entry.id}:`, "m"),
    `${entry.id} has no mark in components/ui/svgs/brands.tsx`
  );
}

// 10b. Opening a card reconnects it rather than deleting and rebuilding it.
//      KPA-159. The source is read rather than imported, for the reason 9d
//      gives: node strips types and leaves JSX alone, so importing a .tsx
//      answers ERR_UNKNOWN_FILE_EXTENSION. Each pattern is a string only the
//      new code could produce, checked against the pre-change file before
//      this story and found in none of them.
assert.match(
  dialog,
  /function ConnectionDetail/,
  "the connections screen has no detail dialog to open a card into"
);
assert.match(
  dialog,
  /function Reconnect\(/,
  "the detail dialog offers no way to reconnect a grant method"
);
assert.match(
  dialog,
  /provider: connection\.provider,[\s\S]{0,80}services: connection\.services,[\s\S]{0,80}returnsTo: "\/connections"/,
  "Reconnect does not post the standing connection to /api/connections/authorize"
);
assert.match(
  dialog,
  /Signing in as a different account creates a second connection/,
  "the dialog does not say a reconnect under a different account makes a second row"
);
assert.match(
  dialog,
  /id=\{secretId\}\s*\n\s*type="password"/,
  "the replacement key box is not a password box"
);
assert.match(
  dialog,
  /replaceKey\(connection\.id, secret, expiresOn \|\| null\)/,
  "the typed key reaches no PATCH, so the form collects it and sends it nowhere"
);

// 10c. A card whose method takes a key may be renamed, and a card whose
//      method runs a grant may not. KPA-162. The rule is the same one
//      `connectionNamed` depends on: a grant method's name is the account the
//      provider reported, so letting it drift breaks the match a second grant
//      makes. Each pattern below is a string only the new code could produce,
//      checked against the pre-change file and found in none of it.
assert.match(
  dialog,
  /function RenameConnection\(/,
  "the connections screen offers no way to rename a connection"
);
assert.match(
  dialog,
  /renameConnection\(connection\.id, trimmed\)/,
  "the rename form reaches no PATCH, so the typed name goes nowhere"
);
assert.match(
  dialog,
  /The provider names this card, so it cannot be renamed here\./,
  "a grant method's card does not say the provider names it"
);
// The same screen must not then offer a reconnect as the way to rename it. A
// grant under a different account makes a second connection, which the
// Reconnect block says, so the two sentences would disagree.
assert.doesNotMatch(
  dialog,
  /Reconnect under a different account to change it/,
  "the screen offers a reconnect as a rename, and contradicts its own Reconnect text"
);
assert.match(
  dialog,
  /Renaming it changes the name recipients see beside the address/,
  "a sending connection's rename form does not say the name travels in the mail"
);
assert.match(
  dialog,
  /\{!grant && <RenameConnection connection=\{connection\} sends=\{sends\} \/>\}/,
  "the rename form opens for a grant method, which the provider alone may name"
);

// 10d. The detail dialog shows the address on a connection that has one.
//      KPA-160. The pattern names the behaviour, not the whitespace, and it
//      is checked against the pre-change source and found in none of it.
assert.match(
  dialog,
  /connection\.sendFrom && <Field label="Send from" value=\{connection\.sendFrom\} \/>/,
  "the detail dialog does not show the send-from address"
);

// 10e. Claude's subscription takes a setup token and opens nothing. KPA-86.
//      The old method opened claude.ai/login and captured nothing, so a card
//      that went back to a link would look connected and store no credential.
const subscription = PROVIDERS.find((entry) => entry.id === "claude")?.methods.find(
  (method) => method.id === "subscription"
);
assert.ok(subscription, "Claude offers no subscription method");
assert.equal(subscription.signIn, undefined, "the subscription method opens a page again");
assert.ok(
  (subscription.fields ?? []).some((field) => field.kind === "secret"),
  "the subscription method takes no setup token"
);
assert.ok(
  (subscription.fields ?? []).some((field) => field.kind === "date"),
  "the setup token is undated"
);

console.log(
  "connections OK: ten providers each with a mark, only web addresses open, a key opens nothing, " +
    `Voyage names ${EMBEDDING.model} at ${EMBEDDING.dimension}, the Jira token is dated, ` +
    "the Resend probe costs nothing, Resend alone asks for a Send from address, " +
    "a card reconnects in place rather than deleting and rebuilding, a card whose " +
    "method takes a key may be renamed while a grant method's card says the provider " +
    "names it, the detail dialog reads the sending address back, and Claude's subscription " +
    "takes a dated setup token and opens no page"
);

// ══ The same claims, against the rows ═══════════════════════════════════════

// KPA-127 moved the list off the browser, so the catalogue above is no longer
// the whole answer: a stored connection names a provider and a method, and a
// stored credential is what the screen must never read back. Three claims run
// here, and each one is silent when it breaks.
//
// The read narrows. `listConnections` names its columns, so its answer holds
// the thirteen fields below and no secret.
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

/** The thirteen fields a screen may see. The sealed bytes are not among them.
 *  Counted from this array on 1 October 2026: the comment above it read "ten"
 *  while the array held eleven, and KPA-160 added the twelfth. KPA-105 added
 *  `site`, the thirteenth. */
const SEEN = [
  "expiresOn",
  "hasSecret",
  "id",
  "issuedOn",
  "method",
  "name",
  "provider",
  "sendFrom",
  "services",
  "site",
  "verdict",
  "verifiedOk",
  "verifiedOn",
];

let added: string | null = null;
try {
  // 11. A connection made and a key sealed against it, which is the round trip
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

  // 12. The whole answer, searched for the secret itself.
  assert.ok(
    !JSON.stringify(list).includes(SECRET),
    "the read carried the plaintext",
  );

  // 13. Every stored row draws a card, which needs a provider and a method
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
    `connection rows OK: ${list.length} read, thirteen fields each, and no secret among them`,
  );
} finally {
  if (added) await removeConnection(client, added);
  client.release();
  await pool.end();
  if (heldKey === undefined) delete process.env[KEY_VARIABLE];
  else process.env[KEY_VARIABLE] = heldKey;
}
