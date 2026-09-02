// The check the connection dialog needs. Run: npm run check
//
// One rule here guards the browser. The dialog opens a tab at an address a
// person typed, so a `javascript:` address in that box would run on the page
// that opened it. The rest hold the catalogue to its own shape, because the
// dialog reads it rather than asking a question per provider.

import assert from "node:assert/strict";

import { EMBEDDING } from "../../../src/embedding.ts";
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
