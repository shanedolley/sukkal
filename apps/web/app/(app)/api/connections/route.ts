/**
 * The connections, over HTTP.
 *
 * NO SHAPE OF THIS HANDLER RETURNS A SECRET. `listConnections` names its
 * columns and `ciphertext` is not among them, so `GET` cannot carry one out.
 * `POST`, `PATCH` and `DELETE` answer `{ ok: true }`, so none hands back what
 * it was given. `test/connections-read.test.ts` asserts the exact key set.
 *
 * `PATCH` RECONNECTS A ROW RATHER THAN REPLACING IT. KPA-159 asks for a way
 * to retype a dead key without losing the connection's id and history, and
 * `POST` cannot do that: it inserts, and the table refuses a duplicate
 * (provider, name). `PATCH` is the one route change this story adds.
 *
 * `DELETE` TELLS THE PROVIDER FIRST, AND STILL NAMES NO PLAINTEXT.
 * `revokeConnection` in `src/connections/oauth.ts` opens the secret, sends it
 * to the provider, and hands this route a verdict. The first shape of that
 * work opened the secret here, and `test/connections-read.test.ts` refused it:
 * the one function that returns a plaintext belongs behind a seam rather than
 * in a handler.
 *
 * THE SECRET TRAVELS ONCE, IN THE REQUEST BODY. It reaches `setCredential`,
 * which seals it with AES-256-GCM under the connection's own id, and nothing
 * here logs it: the two error paths below carry a message and a `cause` the
 * secret never entered.
 *
 * THE CONNECTION AND ITS CREDENTIAL ARE ONE WRITE. Both statements run on one
 * client inside a transaction, so a failed seal leaves no connection claiming
 * a key it does not hold.
 *
 * EVERY FIELD IS CHECKED HERE, not only on the form. A request body is a trust
 * boundary, and the dialog is the only caller today rather than the only
 * caller possible. `PROVIDERS` is the catalogue the screen draws from, so the
 * two cannot name different providers.
 *
 * IT SITS UNDER `(app)`, SO THE GATE ALREADY REFUSED A STRANGER. `proxy.ts`
 * denies by default and `lib/public-paths.ts` names this path nowhere.
 * `requireOwner` is the second check, which Next's own documentation asks for:
 * a matcher change can silently remove the proxy's coverage. This file said
 * the route authenticated nobody until KPA-103, which was true when KPA-127
 * wrote it and stopped being true when KPA-128 built the gate.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  isEmail,
  needsSendFrom,
  PROVIDERS,
  refusedMethod,
} from "@/lib/providers";
import { requireOwner } from "@/lib/session";
import {
  jiraSecret,
  jiraSite,
  replaceJiraToken,
} from "../../../../../../src/connections/jira.ts";
import { revokeConnection } from "../../../../../../src/connections/oauth.ts";
import {
  addConnection,
  connectionNamed,
  listConnections,
  methodOf,
  removeConnection,
  renameConnection,
  setCredential,
} from "../../../../../../src/connections/store.ts";

/** The reason goes to the server's log and never to the browser: a connection
 *  error names the host, the database and the user. */
function refused(what: string, cause: unknown): Response {
  console.error(`${what}:`, cause);
  return NextResponse.json(
    { error: "The database did not answer." },
    { status: 503 }
  );
}

const bad = (error: string): Response =>
  NextResponse.json({ error }, { status: 400 });

/** A calendar date, as the form's own date box writes one. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Postgres reports every constraint it refuses in class 23. That is a body
 *  this route admitted and the table did not, which is the caller's fault
 *  rather than the box being down. */
function refusedByTable(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === "string" &&
    (cause as { code: string }).code.startsWith("23")
  );
}

/** The one-per-site index, which `migrations/035_connection_site.sql` names. */
function siteTaken(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { constraint?: unknown }).constraint === "connections_one_per_site"
  );
}

/** A Jira token card is the one method whose credential is two values. */
const isJiraToken = (provider: string, method: string): boolean =>
  provider === "jira" && method === "token";

export async function GET(): Promise<Response> {
  // The proxy already refused a stranger. This is the second check Next's
  // documentation asks for, because a matcher change removes the first
  // silently.
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // `src/connections/store.ts` takes a client rather than a pool, because a
  // write there spans two statements. So every call here checks one out.
  const client = await db().connect();
  try {
    return NextResponse.json(await listConnections(client));
  } catch (cause) {
    return refused("connections", cause);
  } finally {
    client.release();
  }
}

export async function POST(request: Request): Promise<Response> {
  // The proxy already refused a stranger. This is the second check Next's
  // documentation asks for, because a matcher change removes the first
  // silently.
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return bad("Send a JSON body.");

  const { provider, name, method, services, secret, expiresOn, sendFrom, site, email } =
    body;

  if (
    typeof provider !== "string" ||
    !PROVIDERS.some((entry) => entry.id === provider)
  ) {
    return bad("That is not a provider this build offers.");
  }
  if (typeof name !== "string" || name.trim() === "") {
    return bad("Name the account.");
  }
  if (typeof method !== "string" || method.trim() === "") {
    return bad("Choose a method.");
  }
  // Before any row exists: a method the card does not offer stores a hollow
  // row with no credential, which is what the Jira OAuth box did.
  const refusal = refusedMethod(provider, method.trim());
  if (refusal) return bad(refusal);
  const chosen = services ?? [];
  if (
    !Array.isArray(chosen) ||
    chosen.some((one) => typeof one !== "string" || one.trim() === "")
  ) {
    return bad("A service is named by its id.");
  }
  // A blank secret is a method that asked for no key. One typed and left empty
  // is refused by `setCredential`, which the dialog's own check prevents.
  const key = typeof secret === "string" ? secret : "";
  if (expiresOn != null && (typeof expiresOn !== "string" || !DAY.test(expiresOn))) {
    return bad("Write the expiry as YYYY-MM-DD.");
  }

  // THE SEND FROM ADDRESS IS CHECKED HERE, AND THE BROWSER'S CHECK IS A
  // CONVENIENCE. KPA-158 gave it a column because `name` was carrying it, and
  // `deliver` in src/auth/reset.ts puts it in a mail header: an address holding
  // whitespace, a comma or an angle bracket is a header somebody else wrote.
  // The column's own check is a floor and refuses the same shapes, so this
  // answers with a sentence rather than letting Postgres answer with a
  // constraint name.
  if (sendFrom != null && typeof sendFrom !== "string") {
    return bad("Write Send from as an email address.");
  }
  const address = typeof sendFrom === "string" ? sendFrom.trim() : "";
  if (address !== "" && !isEmail(address)) {
    return bad("Write Send from as an email address.");
  }
  // A provider whose form asks for the address has to have one, and every
  // other provider is untouched. `needsSendFrom` reads that off the catalogue
  // rather than naming Resend, so a second sender gains the rule with the field.
  if (address === "" && needsSendFrom(provider)) {
    return bad("Give it the address the mail comes from.");
  }

  // A JIRA TOKEN CARD IS A SITE, AN ACCOUNT EMAIL AND A TOKEN, and the token
  // is sent to the site. `jiraSite` is the guard that keeps it on an
  // atlassian.net origin, and it runs here before any row exists. The email
  // and token are sealed as one credential.
  let sealed = key;
  let origin: string | null = null;
  if (isJiraToken(provider, method.trim())) {
    origin = jiraSite(typeof site === "string" ? site : "");
    if (origin === null) {
      return bad("Give the Jira site as https://your-team.atlassian.net.");
    }
    if (typeof email !== "string" || !isEmail(email)) {
      return bad("Give the email of the Atlassian account.");
    }
    if (key.trim() === "") return bad("Paste the API token.");
    sealed = jiraSecret(email, key);
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const id = await addConnection(client, {
      provider,
      name: name.trim(),
      method: method.trim(),
      services: chosen as string[],
      sendFrom: address === "" ? null : address,
      site: origin,
    });
    if (sealed.trim() !== "") {
      await setCredential(client, id, sealed, {
        expiresOn: (expiresOn as string | undefined) ?? null,
      });
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => {});
    if (siteTaken(cause)) return bad("That site already has a connection.");
    if (refusedByTable(cause)) {
      return bad("That account is already on this provider.");
    }
    // The secret is not in `cause`. `setCredential` seals it before the
    // statement runs, so the parameter the driver reports is the ciphertext.
    return refused("connection write", cause);
  } finally {
    client.release();
  }
}

/**
 * Replaces the credential on a connection that already exists, renames it, or
 * both. KPA-159 and KPA-162.
 *
 * POST CANNOT DO EITHER. `addConnection` inserts a row, and the table refuses
 * a second row on the same (provider, name), so posting the same account back
 * answers "That account is already on this provider." A dead key therefore
 * had no way to be retyped without deleting the connection first, which threw
 * away its id, its created_at and its verification history. PATCH updates the
 * credential in place instead, through the same `setCredential` POST already
 * calls, so a reconnect and a first connection seal a key the same way.
 *
 * A GRANT METHOD IS NOT RENAMEABLE. `connectionNamed` matches a second grant
 * to its row by provider and `lower(name)`, which the OAuth callback calls on
 * every grant. A name this route let drift on such a card would make the next
 * grant match nothing, write a second row, and leave the first dead beside
 * it: the failure KPA-159 shipped to prevent, arriving by another door. The
 * screen already hides the rename form on such a card; this check is the
 * boundary, which admits a request the screen never sends.
 *
 * A RENAME AND A RESEAL ARE ONE WRITE, when a request carries both. Both
 * statements run on one client inside a transaction, so a failed seal leaves
 * no renamed row.
 */
export async function PATCH(request: Request): Promise<Response> {
  // The proxy already refused a stranger. This is the second check Next's
  // documentation asks for, because a matcher change removes the first
  // silently.
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  // The column is a bigint, so anything else is a request Postgres would
  // refuse for its syntax rather than a connection nobody holds.
  if (!id || !/^\d+$/.test(id)) return bad("Name the connection to update.");

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return bad("Send a JSON body.");

  const { secret, expiresOn, name } = body;
  if (secret === undefined && name === undefined) {
    return bad("Give the new key, or a new name.");
  }

  let newSecret: string | null = null;
  if (secret !== undefined) {
    if (typeof secret !== "string" || secret.trim() === "") {
      return bad("Give the new key.");
    }
    newSecret = secret;
  }
  if (expiresOn != null && (typeof expiresOn !== "string" || !DAY.test(expiresOn))) {
    return bad("Write the expiry as YYYY-MM-DD.");
  }

  let newName: string | null = null;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      return bad("Name the connection.");
    }
    newName = name.trim();
  }

  const client = await db().connect();
  try {
    // Refuses an id that holds no row, rather than acting on a connection
    // nobody holds.
    const row = await methodOf(client, id);
    if (row === null) return bad("That connection does not exist.");

    if (newName !== null) {
      const method = PROVIDERS.find((entry) => entry.id === row.provider)?.methods.find(
        (entry) => entry.id === row.method
      );
      if (method?.grant) {
        return bad("The provider names that card.");
      }

      // A case-insensitive clash would make a grant ambiguous while passing
      // the table's own check, which is case sensitive.
      const clash = await connectionNamed(client, row.provider, newName);
      if (clash !== null && clash !== id) {
        return bad("That account is already on this provider.");
      }
    }

    await client.query("BEGIN");
    if (newName !== null) await renameConnection(client, id, newName);
    if (newSecret !== null) {
      const dates = { expiresOn: (expiresOn as string | undefined) ?? null };
      // A Jira card keeps its account email and takes the token alone.
      if (isJiraToken(row.provider, row.method)) {
        await replaceJiraToken(client, id, newSecret, dates);
      } else {
        await setCredential(client, id, newSecret, dates);
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => {});
    if (refusedByTable(cause)) {
      return bad("That account is already on this provider.");
    }
    // The secret is not in `cause`. `setCredential` seals it before the
    // statement runs, so the parameter the driver reports is the ciphertext.
    return refused("connection update", cause);
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  // The proxy already refused a stranger. This is the second check Next's
  // documentation asks for, because a matcher change removes the first
  // silently.
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  // The column is a bigint, so anything else is a request Postgres would
  // refuse for its syntax rather than a connection nobody holds.
  if (!id || !/^\d+$/.test(id)) return bad("Name the connection to remove.");

  const client = await db().connect();
  try {
    // THE PROVIDER IS TOLD FIRST, AND THE ROW GOES ONLY IF IT AGREED. KPA-103
    // asks for that in as many words. Removing the row alone leaves a token
    // Google still honours and Sukkal can no longer see, which is worse than the
    // connection this was meant to end: nobody can revoke what nobody knows
    // about.
    const said = await revokeConnection(client, id, fetch);
    if (!said.revoked) {
      // The row stands, and the reason reaches the person rather than the log
      // alone. Trying again is what fixes a provider that was down.
      return NextResponse.json(
        { error: `The connection was kept, because the provider did not revoke the token: ${said.said}` },
        { status: 502 }
      );
    }

    // The credential goes with it, by the cascade migration 016 declares.
    await removeConnection(client, id);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    // A token never enters `cause`: `secretFor` returns it and `revoke` puts
    // it in a body, and neither the URL nor the message carries one.
    return refused("connection removal", cause);
  } finally {
    client.release();
  }
}
