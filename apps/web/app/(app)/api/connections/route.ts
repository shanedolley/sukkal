/**
 * The connections, over HTTP.
 *
 * NO SHAPE OF THIS HANDLER RETURNS A SECRET. `listConnections` names its
 * columns and `ciphertext` is not among them, so `GET` cannot carry one out.
 * `secretFor` is the only function that returns a plaintext, no route may call
 * it, and this file does not import it. `POST` answers `{ ok: true }` and
 * `DELETE` answers the same, so neither hands back what it was given.
 * `test/connections-read.test.ts` asserts the exact key set.
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
 * This route authenticates nobody, because nothing does yet. ADR-0009 gives
 * the installation a password; the session that would gate this handler
 * belongs to the story that builds sign-in.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { PROVIDERS } from "@/lib/providers";
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
  const id = new URL(request.url).searchParams.get("id");
  // The column is a bigint, so anything else is a request Postgres would
  // refuse for its syntax rather than a connection nobody holds.
  if (!id || !/^\d+$/.test(id)) return bad("Name the connection to remove.");

  const client = await db().connect();
  try {
    // The credential goes with it, by the cascade migration 016 declares.
    await removeConnection(client, id);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return refused("connection removal", cause);
  } finally {
    client.release();
  }
}
