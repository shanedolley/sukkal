/**
 * One OAuth grant, for whichever provider offers one.
 *
 * KPA-103 asks for one route pair serving every provider from a per-provider
 * record holding the urls and the scopes, so that a fourth provider is a
 * record rather than a route. `GRANTS` below is that record, and everything
 * under it is provider-agnostic.
 *
 * THE CLIENT IS THE APPLICATION'S, AND THE TOKEN IS AN ACCOUNT'S. Two secrets
 * meet here and they live in different places. `GOOGLE_OAUTH_CLIENT_ID` and
 * `GOOGLE_OAUTH_CLIENT_SECRET` identify KPA to Google and sit in the
 * environment, because the callback needs them before any connection row
 * exists. What the grant returns belongs to one account, so it goes through
 * `crypto.ts` into `connection_credentials` like every other vendor
 * credential. `docs/runbooks/secrets.md` records the split.
 *
 * PKCE ON EVERY GRANT, INCLUDING THE ONES THAT DO NOT REQUIRE IT. RFC 7636
 * exists because an authorization code can be intercepted between the provider
 * and the redirect. The verifier costs two lines and removes the whole class,
 * so nothing here offers a way to leave it out.
 *
 * NOTHING HERE REACHES THE NETWORK BY ITSELF. Every function that calls a
 * provider takes the fetcher as an argument, which is the shape
 * `src/connections/verify.ts` already uses: a test drives every answer a
 * vendor can give, and only the caller that passes the real `fetch` touches
 * one.
 *
 * `now` is an argument everywhere, so a test moves ten minutes in one line.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';

import { fingerprint } from '../auth/session.ts';

/** How long a grant may stay in flight, in minutes. */
export const LIFETIME_MINUTES = 10;

/** 32 bytes, which is 256 bits. Nothing guesses a state or a verifier. */
const RANDOM_BYTES = 32;

/** What one provider needs, and the whole of what differs between them. */
export interface Grant {
  /** Where the browser goes to consent. */
  authorize: string;
  /** Where a code and a refresh token are exchanged. */
  token: string;
  /** Where a token is revoked, or null when the provider offers no endpoint. */
  revoke: string | null;
  /**
   * Asked on every grant, whatever the person chose.
   *
   * These three name the account rather than open anything. The callback
   * needs the address to tell three Google accounts apart, so a grant that
   * omitted them would produce one connection nobody could name.
   */
  baseScopes: string[];
  /**
   * What each service on the card adds, keyed by the service id
   * `apps/web/lib/providers.ts` gives it.
   *
   * A person who asks for mail alone consents to mail alone. Asking for
   * everything and using a third of it puts the difference on the consent
   * screen, where it reads as a demand rather than a default.
   */
  scopesByService: Record<string, string[]>;
  /** Where to ask which account just consented, and which field holds it. */
  identity: { url: string; field: string };
  /**
   * Parameters this provider needs on the authorize url beyond the standard
   * ones. Google returns no refresh token without `access_type=offline`, and
   * returns one only on the first grant without `prompt=consent`.
   */
  extra: Record<string, string>;
  /** The environment variables holding the client. */
  clientIdVariable: string;
  clientSecretVariable: string;
}

/**
 * Every provider KPA can run a grant for.
 *
 * MICROSOFT IS ABSENT, AND THE BRIEF IS WHY. KPA-103 names it and calls its
 * fate an open question. `docs/project-brief.md` answers it: all three
 * mailboxes are Google, so the Microsoft surface is customer tenants where
 * Shane is a guest, and "Graph access to those tenants is not obtainable and
 * KPA will not pursue it". A record for a grant nobody may run is a button
 * that fails on press.
 *
 * ZOOM IS ABSENT FOR A SMALLER REASON. An unpublished Zoom app installs only
 * on the developer's own account, and a free account holds no cloud recording
 * to read. Adding it later is this object gaining a key.
 */
export const GRANTS: Record<string, Grant> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    baseScopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    // The keys are the service ids on the Google card in
    // `apps/web/lib/providers.ts`. Every one appears, and
    // `apps/web/scripts/check-connections.ts` fails when a card gains a
    // service this map does not answer for.
    scopesByService: {
      gmail: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      calendar: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
      // A Meet recording is reached through the event that held it, so this
      // adds the calendar read and no scope of its own.
      meet: ['https://www.googleapis.com/auth/calendar.readonly'],
      drive: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      // Deliberately empty. The Keep API needs `keep.readonly`, which Google
      // restricts to Workspace Enterprise, and `workspace-mcp` holds no such
      // scope on any of the three accounts. Choosing Keep therefore grants
      // nothing today, and asking for a scope Google would refuse would fail
      // the whole grant rather than one service.
      keep: [],
    },
    identity: { url: 'https://openidconnect.googleapis.com/v1/userinfo', field: 'email' },
    extra: { access_type: 'offline', prompt: 'consent' },
    clientIdVariable: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretVariable: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
};

/**
 * Where this installation answers, without a trailing slash.
 *
 * Configured rather than guessed. The value has to match a redirect URI the
 * provider's console holds, character for character, and a value read off the
 * request would be whatever `x-forwarded-host` said. Trusting a header is the
 * class of defect ADR-0023 refused for identity, and it fails here in a way
 * nobody can read: the provider answers `redirect_uri_mismatch` and names
 * neither value.
 *
 * The default suits `next dev` and nothing else. A tunnel sets this.
 */
export function installationUrl(): string {
  return (process.env['KPA_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
}

/**
 * The path a provider redirects to, and the one its console must hold.
 *
 * It sits outside `/api/` where every other machine endpoint lives, because
 * this address is typed into a console once and is then near permanent: the
 * provider compares it character for character, and moving it means editing
 * every console that holds it. `/oauth2/callback` names the protocol rather
 * than the screen it returns to, which is what a route serving every provider
 * should say. The route file is still under `(app)`, so the gate covers it.
 */
export const CALLBACK_PATH = '/oauth2/callback';

/**
 * Where a provider sends the browser back.
 *
 * Both routes call this rather than each building the string. The authorize
 * request and the token request must send the same value, and a provider that
 * sees two rejects the second with an error naming neither.
 */
export function redirectUri(): string {
  return `${installationUrl()}${CALLBACK_PATH}`;
}

/** The record for `provider`, or a throw naming it. */
export function grantFor(provider: string): Grant {
  const grant = GRANTS[provider];
  if (grant === undefined) {
    throw new Error(`no OAuth grant is configured for ${provider}.`);
  }
  return grant;
}

/** The client id and secret for `grant`, from the environment. */
export function clientFor(grant: Grant): { id: string; secret: string } {
  const id = process.env[grant.clientIdVariable];
  const secret = process.env[grant.clientSecretVariable];
  if (!id || !secret) {
    throw new Error(
      `set ${grant.clientIdVariable} and ${grant.clientSecretVariable}. ` +
        'docs/runbooks/secrets.md says where they come from.',
    );
  }
  return { id, secret };
}

/**
 * What to ask for, given the services somebody chose.
 *
 * The base scopes always go. Each chosen service adds its own, and a service
 * the record does not answer for adds nothing rather than throwing: a card
 * gaining a service must not break the grant for the four beside it.
 * `apps/web/scripts/check-connections.ts` is what catches the gap instead.
 *
 * The result is sorted and holds no duplicate, so two services sharing a scope
 * ask for it once and two identical requests build one string.
 */
export function scopesFor(grant: Grant, services: readonly string[]): string[] {
  const asked = new Set(grant.baseScopes);
  for (const service of services) {
    for (const scope of grant.scopesByService[service] ?? []) asked.add(scope);
  }
  return [...asked].sort();
}

/**
 * The S256 challenge for `verifier`.
 *
 * Base64url of the SHA-256, with no padding, which is what RFC 7636 names.
 * The plain method is not offered: it sends the verifier itself to the
 * provider, so an intercepted authorize request carries both halves.
 */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** A grant in flight, as `begin` returns it. The state is returned once. */
export interface Started {
  /** Where to send the browser. */
  url: string;
  /** The value the provider hands back. Stored only as its SHA-256. */
  state: string;
  expiresAt: Date;
}

/**
 * Starts a grant, and answers where the browser goes.
 *
 * `redirectUri` is passed in rather than built here, because it depends on the
 * address the installation answers at and this module knows nothing about
 * hosts. The value must match one the provider's console holds, character for
 * character, or the provider refuses before the person sees anything.
 */
export async function begin(
  client: ClientBase,
  provider: string,
  redirectUri: string,
  services: readonly string[],
  now: Date,
  returnsTo: string | null = null,
): Promise<Started> {
  const grant = grantFor(provider);
  const { id } = clientFor(grant);

  const state = randomBytes(RANDOM_BYTES).toString('base64url');
  const verifier = randomBytes(RANDOM_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + LIFETIME_MINUTES * 60 * 1000);

  await client.query(
    `INSERT INTO oauth_grants (id, provider, verifier, returns_to, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [fingerprint(state), provider, verifier, returnsTo, now, expiresAt],
  );

  const url = new URL(grant.authorize);
  url.searchParams.set('client_id', id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopesFor(grant, services).join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(grant.extra)) {
    url.searchParams.set(key, value);
  }

  return { url: url.toString(), state, expiresAt };
}

/** Why a state was refused, for a caller that has to say something. */
export type Refusal = 'unknown' | 'expired';

/** What was waiting behind a state. */
export interface Pending {
  provider: string;
  verifier: string;
  returnsTo: string | null;
}

/**
 * Claims the grant `state` names, or says why not.
 *
 * THE DELETE IS THE CLAIM. One statement takes the row and returns it, so two
 * callbacks carrying one state race for something only one of them gets. A
 * column read first and written after would let both through, and a replayed
 * callback is exactly what the state exists to refuse.
 */
export async function claim(
  client: ClientBase,
  state: string | undefined | null,
  now: Date,
): Promise<Pending | { refused: Refusal }> {
  if (!state || state.trim() === '') return { refused: 'unknown' };

  const claimed = await client.query<{
    provider: string;
    verifier: string;
    returns_to: string | null;
    expires_at: Date;
  }>(
    `DELETE FROM oauth_grants WHERE id = $1
     RETURNING provider, verifier, returns_to, expires_at`,
    [fingerprint(state)],
  );

  const row = claimed.rows[0];
  if (row === undefined) return { refused: 'unknown' };
  if (row.expires_at.getTime() <= now.getTime()) return { refused: 'expired' };

  return { provider: row.provider, verifier: row.verifier, returnsTo: row.returns_to };
}

/** What a provider returns from the token endpoint, as this module reads it. */
export interface Tokens {
  accessToken: string;
  /** Absent when the provider returns none, which is every grant after the
   *  first unless the request forced consent. */
  refreshToken: string | null;
  /** When the access token stops working. Derived from `expires_in`. */
  expiresAt: Date;
  /** What the provider actually granted, which may be less than was asked. */
  scopes: string[];
}

/** The fetcher, so a test drives every answer without a network. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One form-encoded POST to a token endpoint, and what it answered. */
async function post(
  fetcher: Fetcher,
  url: string,
  body: Record<string, string>,
  now: Date,
): Promise<Tokens> {
  const answer = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const text = await answer.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${url} answered ${String(answer.status)} and no JSON.`);
  }

  if (!answer.ok) {
    // The provider's own words, which name the cause: invalid_grant for a
    // revoked token, invalid_client for a client that does not match. Nothing
    // here carries a secret, because the error names the fault and not the
    // request.
    const error = typeof parsed['error'] === 'string' ? parsed['error'] : 'no error named';
    const detail =
      typeof parsed['error_description'] === 'string' ? `: ${parsed['error_description']}` : '';
    throw new Error(`${url} refused the request. ${error}${detail}`);
  }

  const accessToken = parsed['access_token'];
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error(`${url} answered without an access token.`);
  }

  // A provider that names no lifetime gets the conservative reading rather
  // than a token this treats as permanent.
  const seconds = typeof parsed['expires_in'] === 'number' ? parsed['expires_in'] : 0;
  const refresh = parsed['refresh_token'];
  const scope = parsed['scope'];

  return {
    accessToken,
    refreshToken: typeof refresh === 'string' && refresh !== '' ? refresh : null,
    expiresAt: new Date(now.getTime() + seconds * 1000),
    scopes: typeof scope === 'string' && scope !== '' ? scope.split(' ') : [],
  };
}

/** Exchanges an authorization code for tokens. */
export function exchange(
  grant: Grant,
  code: string,
  verifier: string,
  redirectUri: string,
  now: Date,
  fetcher: Fetcher,
): Promise<Tokens> {
  const { id, secret } = clientFor(grant);
  return post(
    fetcher,
    grant.token,
    {
      client_id: id,
      client_secret: secret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    },
    now,
  );
}

/**
 * Trades a refresh token for a new access token.
 *
 * The provider usually returns no new refresh token, so `refreshToken` comes
 * back null and the caller keeps the one it holds. A provider that does rotate
 * returns one, and the caller stores it: dropping it would leave KPA holding a
 * token the provider has retired.
 */
export function renew(
  grant: Grant,
  refreshToken: string,
  now: Date,
  fetcher: Fetcher,
): Promise<Tokens> {
  const { id, secret } = clientFor(grant);
  return post(
    fetcher,
    grant.token,
    {
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
    now,
  );
}

/**
 * Tells the provider to forget a token, and answers whether it agreed.
 *
 * KPA-103 requires a failed revoke to leave the connection standing and report
 * itself, rather than dropping the row silently. So this returns a verdict
 * instead of throwing: the caller decides, and a row that survives a failed
 * revoke is a row somebody can try again.
 *
 * A provider offering no revoke endpoint answers `no endpoint`. That is not a
 * failure. It is the truth about the provider.
 */
export async function revoke(
  grant: Grant,
  token: string,
  fetcher: Fetcher,
): Promise<{ revoked: boolean; said: string }> {
  if (grant.revoke === null) {
    return { revoked: false, said: 'the provider publishes no revoke endpoint.' };
  }

  const { id, secret } = clientFor(grant);
  try {
    const answer = await fetcher(grant.revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: id, client_secret: secret }).toString(),
    });
    if (answer.ok) return { revoked: true, said: 'the provider forgot the token.' };
    return {
      revoked: false,
      said: `the provider answered ${String(answer.status)}.`,
    };
  } catch (cause) {
    // A network failure is not a revoked token. Saying so is the whole point.
    return {
      revoked: false,
      said: cause instanceof Error ? cause.message : 'the request did not complete.',
    };
  }
}

/**
 * Which account consented, by its address.
 *
 * The callback needs this and nothing else about the person. Three Google
 * accounts each produce a connection, and the address is what tells them
 * apart, so a grant that could not answer would overwrite one row three times.
 *
 * The token goes in the header rather than the query, for the reason
 * `src/connections/verify.ts` gives: a URL reaches the vendor's access log and
 * this project's own.
 */
export async function whoami(
  grant: Grant,
  accessToken: string,
  fetcher: Fetcher,
): Promise<string> {
  const answer = await fetcher(grant.identity.url, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!answer.ok) {
    throw new Error(
      `${grant.identity.url} answered ${String(answer.status)} and named no account.`,
    );
  }

  const parsed = (await answer.json()) as Record<string, unknown>;
  const who = parsed[grant.identity.field];
  if (typeof who !== 'string' || who.trim() === '') {
    throw new Error(`${grant.identity.url} carried no ${grant.identity.field}.`);
  }
  return who.trim();
}

/**
 * Removes what has run out, and answers how many.
 *
 * `claim` already refuses an expired row, so this frees space rather than
 * closing a hole. Unlike `password_resets`, this table holds a row per grant
 * in flight rather than one per owner, so an abandoned grant accumulates and
 * there is something to clear.
 */
export async function sweepExpired(client: ClientBase, now: Date): Promise<number> {
  const gone = await client.query('DELETE FROM oauth_grants WHERE expires_at <= $1', [now]);
  return gone.rowCount ?? 0;
}
