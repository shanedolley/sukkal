/**
 * The first half of an OAuth grant: where the browser goes.
 *
 * KPA-103 asks for one route pair serving every provider from a per-provider
 * record, so nothing here names Google. `GRANTS` in
 * `src/connections/oauth.ts` decides which providers this answers for, and a
 * fourth provider is a key in that object rather than a route beside this one.
 *
 * IT SITS UNDER `(app)`, SO THE GATE ALREADY REFUSED A STRANGER. `proxy.ts`
 * denies by default and `lib/public-paths.ts` names this path nowhere.
 * `requireOwner` is the second check, which Next's own documentation asks for:
 * a matcher change can silently remove the proxy's coverage.
 *
 * IT IS A POST, BECAUSE IT WRITES. A grant in flight is a row, and a GET that
 * writes one is a row any page can create by embedding an image.
 *
 * THE BROWSER RECEIVES A URL AND NEVER A TOKEN. There is no token yet, which
 * is the point of the pair: the code comes back through the callback, and the
 * exchange happens on the server where the client secret lives.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { PROVIDERS } from "@/lib/providers";
import { requireOwner } from "@/lib/session";
import {
  GRANTS,
  begin,
  redirectUri,
} from "../../../../../../../src/connections/oauth.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const provider = typeof body?.["provider"] === "string" ? body["provider"] : "";
  const returnsTo =
    typeof body?.["returnsTo"] === "string" ? body["returnsTo"] : null;

  // Every field is checked here and not only on the form. `PROVIDERS` is the
  // catalogue the screen draws from, so the two cannot name different
  // providers, and `GRANTS` says which of them KPA can actually run a grant
  // for. Microsoft is on the card and in neither, which the brief settles.
  if (!PROVIDERS.some((entry) => entry.id === provider)) {
    return NextResponse.json({ error: "No such provider." }, { status: 400 });
  }
  if (!(provider in GRANTS)) {
    return NextResponse.json(
      { error: `KPA runs no OAuth grant for ${provider}.` },
      { status: 400 }
    );
  }

  // A service the card does not offer is dropped rather than refused. The
  // scopes come from the record, so an invented id adds nothing, and refusing
  // the whole grant over one would be a worse answer than ignoring it.
  const offered = new Set(
    PROVIDERS.find((entry) => entry.id === provider)?.services.map((one) => one.id)
  );
  const asked = Array.isArray(body?.["services"]) ? body["services"] : [];
  const services = asked.filter(
    (one): one is string => typeof one === "string" && offered.has(one)
  );

  const client = await db().connect();
  try {
    const started = await begin(
      client,
      provider,
      redirectUri(),
      services,
      new Date(),
      returnsTo
    );
    return NextResponse.json({ url: started.url });
  } catch (cause) {
    // The message names a missing environment variable by name, which is what
    // somebody setting this up needs. It carries no secret: `clientFor`
    // throws before it reads one.
    console.error("authorize:", cause);
    return NextResponse.json(
      { error: "The grant could not start. The server log says why." },
      { status: 503 }
    );
  } finally {
    client.release();
  }
}
