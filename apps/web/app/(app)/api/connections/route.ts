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
import { isEmail, needsSendFrom, PROVIDERS } from "@/lib/providers";
import { requireOwner } from "@/lib/session";
import { revokeConnection } from "../../../../../../src/connections/oauth.ts";
import {
  addConnection,
  listConnections,
  providerOf,
  removeConnection,
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

  const { provider, name, method, services, secret, expiresOn, sendFrom } =
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

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const id = await addConnection(client, {
      provider,
      name: name.trim(),
      method: method.trim(),
      services: chosen as string[],
      sendFrom: address === "" ? null : address,
    });
    if (key.trim() !== "") {
      await setCredential(client, id, key, {
        expiresOn: (expiresOn as string | undefined) ?? null,
      });
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
    return refused("connection write", cause);
  } finally {
    client.release();
  }
}

/**
 * Replaces the credential on a connection that already exists. KPA-159.
 *
 * POST CANNOT DO THIS. `addConnection` inserts a row, and the table refuses a
 * second row on the same (provider, name), so posting the same account back
 * answers "That account is already on this provider." A dead key therefore
 * had no way to be retyped without deleting the connection first, which threw
 * away its id, its created_at and its verification history. PATCH updates the
 * credential in place instead, through the same `setCredential` POST already
 * calls, so a reconnect and a first connection seal a key the same way.
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

  const { secret, expiresOn } = body;
  if (typeof secret !== "string" || secret.trim() === "") {
    return bad("Give the new key.");
  }
  if (expiresOn != null && (typeof expiresOn !== "string" || !DAY.test(expiresOn))) {
    return bad("Write the expiry as YYYY-MM-DD.");
  }

  const client = await db().connect();
  try {
    // Refuses an id that holds no row, rather than sealing a key against a
    // connection nobody holds.
    const provider = await providerOf(client, id);
    if (provider === null) return bad("That connection does not exist.");

    await setCredential(client, id, secret, {
      expiresOn: (expiresOn as string | undefined) ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
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
