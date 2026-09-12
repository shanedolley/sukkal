/**
 * The second half of an OAuth grant: what the provider sends back.
 *
 * IT ANSWERS AT `/oauth2/callback`, OUTSIDE `/api/` WHERE EVERY OTHER MACHINE
 * ENDPOINT LIVES. The address is typed into a provider's console once and is
 * near permanent after that, so it names the protocol rather than the screen
 * it returns to. `CALLBACK_PATH` in `src/connections/oauth.ts` is the one
 * place it is written, and the file still sits under `(app)` so the gate
 * covers it.
 *
 * The provider redirects the browser here with a code and the state it was
 * given. This claims the grant, exchanges the code where the client secret
 * lives, asks the provider which account consented, and writes a connection
 * with the refresh token sealed against it.
 *
 * IT IS A GET, BECAUSE A REDIRECT IS ONE. Nothing else about it is safe to
 * repeat, and nothing needs to be: the state is single use, so a reloaded
 * callback claims nothing and says so.
 *
 * IT SITS UNDER `(app)` AND STAYS GUARDED. The cookie is `SameSite=lax`,
 * which a top-level GET navigation carries, so the provider's redirect
 * arrives signed in. A public callback would let a stranger finish a grant
 * against this installation.
 *
 * NOTHING REACHES THE BROWSER BUT A REDIRECT. No token, no code, and no
 * fragment of either. What the person sees is the connections screen and one
 * sentence about what happened, carried in the query as an outcome rather
 * than as a message somebody could write. The outcome is one of a fixed set of
 * words, and anything else is dropped, because this route is reachable by a
 * link and a link is written by whoever sends it.
 *
 * NO ADDRESS GOES IN THE QUERY. It did until Shane read one there on
 * 12 September 2026, and he was right: a URL reaches browser history, the
 * server's own access log, and every proxy between the two. Three addresses
 * were already sitting in a dev server log by then. The grid below the notice
 * names the account on its card, which is the same answer in a place that does
 * not travel. Only an OAuth error code rides along now, and RFC 6749 makes
 * those lower case with underscores rather than anything about a person.
 *
 * THE ACCOUNT NAMES THE CONNECTION. Three Google accounts produce three rows
 * because the provider says which one consented. A second grant of the same
 * account refreshes the row rather than adding a fourth.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { safeNext } from "@/lib/next-path";
import { requireOwner } from "@/lib/session";
import {
  claim,
  exchange,
  grantFor,
  redirectUri,
  whoami,
} from "../../../../../../src/connections/oauth.ts";
import {
  addConnection,
  connectionNamed,
  setCredential,
} from "../../../../../../src/connections/store.ts";

/**
 * What an OAuth error code looks like. RFC 6749 names them, and every one is
 * lower case with underscores: `access_denied`, `invalid_scope`.
 *
 * The shape is checked for two reasons. The value arrives in the query and
 * reaches the screen, so a link somebody mails must not be able to put a
 * sentence there: React escapes it either way, and this is about a person
 * reading "call this number to restore your account" under Sukkal's own heading.
 * The same pattern also refuses an address, which is what keeps a person out
 * of the server's access log.
 */
const ERROR_CODE = /^[a-z_]{1,40}$/;

/** Where the person lands, and what the screen says when they get there. */
function landing(base: string, outcome: string, detail?: string): URL {
  const url = new URL(base);
  url.searchParams.set("grant", outcome);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const asked = new URL(request.url).searchParams;
  const state = asked.get("state");
  const code = asked.get("code");
  const refused = asked.get("error");

  const client = await db().connect();
  try {
    // The state is claimed first, whatever else happened. A person who
    // pressed Cancel leaves a row behind otherwise, and it would sit there
    // for the rest of its ten minutes.
    const pending = await claim(client, state, new Date());
    // `safeNext` refuses anything that leaves this installation, so a
    // `returnsTo` planted in the row cannot send somebody elsewhere.
    const back = new URL(
      "returnsTo" in pending ? safeNext(pending.returnsTo ?? "/connections") : "/connections",
      request.url
    ).toString();

    if (refused) {
      // The provider's own word, which is `access_denied` when somebody
      // pressed Cancel. It reaches the screen, so only the shape RFC 6749
      // names goes through: this route is reachable by a link, and a link is
      // written by whoever sends it.
      return NextResponse.redirect(
        landing(back, "refused", ERROR_CODE.test(refused) ? refused : undefined)
      );
    }
    if ("refused" in pending) {
      return NextResponse.redirect(landing(back, pending.refused));
    }
    if (!code) {
      return NextResponse.redirect(landing(back, "no-code"));
    }

    const grant = grantFor(pending.provider);
    const now = new Date();
    const tokens = await exchange(
      grant,
      code,
      pending.verifier,
      redirectUri(),
      now,
      fetch
    );

    // No refresh token means no durable access, whatever the access token
    // says. Google returns one because the record asks for consent every
    // time; a provider that does not leaves Sukkal with an hour and no way to
    // renew, and storing that would read as a working connection.
    if (tokens.refreshToken === null) {
      return NextResponse.redirect(landing(back, "no-refresh-token"));
    }

    const account = await whoami(grant, tokens.accessToken, fetch);

    // The connection and its credential are one write, the way
    // `api/connections` already does it: a failed seal leaves no connection
    // claiming a key it does not hold.
    await client.query("BEGIN");
    try {
      const id =
        (await connectionNamed(client, pending.provider, account)) ??
        (await addConnection(client, {
          provider: pending.provider,
          name: account,
          method: "oauth",
          // What the provider actually granted, which may be less than was
          // asked. The scopes are the truth about the connection, so the
          // services are derived from them rather than from the request.
          services: servicesFrom(pending.provider, tokens.scopes),
        }));

      // The refresh token is the credential, not the access token. One lasts
      // an hour and is re-minted on demand; the other is what makes that
      // possible, so it is the half worth sealing.
      //
      // The expiry comes from the answer, and Google names none for a refresh
      // token, so the column stays null. A date invented here would tell the
      // briefing a credential lapses on a day nobody promised.
      await setCredential(client, id, tokens.refreshToken, {
        issuedOn: now.toISOString().slice(0, 10),
        expiresOn: null,
      });
      await client.query("COMMIT");
      // The address is deliberately absent. `account` named the connection a
      // line above and reaches the screen on its card, not in a URL.
      return NextResponse.redirect(landing(back, "ok"));
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    }
  } catch (cause) {
    // The token never reaches the log. `exchange` throws with the provider's
    // words about the fault, and the request it names carries no secret.
    console.error("oauth callback:", cause);
    return NextResponse.redirect(
      landing(new URL("/connections", request.url).toString(), "failed")
    );
  } finally {
    client.release();
  }
}

/**
 * Which services on the card the granted scopes actually cover.
 *
 * Read from the provider's answer rather than from what was asked, because a
 * person may clear a checkbox on the consent screen. A card claiming Drive
 * against a grant that carries no Drive scope is a card that lies.
 */
function servicesFrom(provider: string, granted: readonly string[]): string[] {
  const held = new Set(granted);
  const byService = grantFor(provider).scopesByService;
  return Object.entries(byService)
    .filter(([, scopes]) => scopes.length > 0 && scopes.every((one) => held.has(one)))
    .map(([service]) => service);
}
