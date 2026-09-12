/**
 * The connections, over HTTP.
 *
 * NO SHAPE OF THIS HANDLER RETURNS A SECRET. `listConnections` names its
 * columns and `ciphertext` is not among them, so `GET` cannot carry one out.
 * `POST` answers `{ ok: true }` and `DELETE` answers the same, so neither
 * hands back what it was given. `test/connections-read.test.ts` asserts the
 * exact key set.
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
import { PROVIDERS } from "@/lib/providers";
import { requireOwner } from "@/lib/session";
import { revokeConnection } from "../../../../../../src/connections/oauth.ts";
import {
  addConnection,
  listConnections,
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

  const { provider, name, method, services, secret, expiresOn } = body;

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

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const id = await addConnection(client, {
      provider,
      name: name.trim(),
      method: method.trim(),
      services: chosen as string[],
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
