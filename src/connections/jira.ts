/**
 * A Jira connection by API token. KPA-105.
 *
 * One connection is one site, and the site is where the token is sent. Shane
 * ruled on 19 October 2026 that Sukkal reaches both Koinon and Collibra by
 * token; the OAuth method for Jira is not built.
 *
 * THE SITE GUARD IS A SECURITY BOUNDARY. `jiraSite` is the only thing that
 * turns a typed address into one a request is built from, and it answers
 * `https://<name>.atlassian.net` or null. The route calls it before a row is
 * written, `probeFor` calls it again before a probe is built, and migration 035
 * holds the column to the same shape. A token sent to any other host is a token
 * given away, and a redirect is refused in `verify.ts` for the same reason.
 *
 * THE CREDENTIAL IS `email:token`, SEALED AS ONE SECRET. That is the string
 * Basic auth base64-encodes, and `isEmail` in `apps/web/lib/providers.ts`
 * refuses a colon, so the first colon always splits the two.
 */
import type { ClientBase } from 'pg';
import { secretFor, setCredential, type CredentialDates } from './store.ts';

/** One lowercase label under atlassian.net: the shape of a Jira Cloud site. */
const HOST = /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/;

/**
 * The https origin `input` names, or null when it is not a Jira Cloud site.
 *
 * "koinon.atlassian.net" gains its scheme, because nobody types it. Anything
 * past the origin is refused rather than trimmed: a path, a query, a fragment,
 * userinfo, a port other than 443 and a scheme other than https all say the
 * address is not what it looks like.
 */
export function jiraSite(input: string): string | null {
  const typed = input.trim();
  // Anything but printable ASCII is not a hostname: a space, a control
  // character, or a look-alike letter from another script.
  if (typed === '' || /[^\x21-\x7e]/.test(typed)) return null;

  let url: URL;
  try {
    url = new URL(typed.includes('://') ? typed : `https://${typed}`);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !HOST.test(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}

/** The one string sealed for a token connection. */
export function jiraSecret(email: string, token: string): string {
  return `${email.trim()}:${token.trim()}`;
}

/** The email and the token in a sealed secret, or null when it holds no colon. */
export function splitJiraSecret(secret: string): { email: string; token: string } | null {
  const at = secret.indexOf(':');
  if (at <= 0 || at === secret.length - 1) return null;
  return { email: secret.slice(0, at), token: secret.slice(at + 1) };
}

/** The Authorization header for a stored secret, or null when it is malformed. */
export function jiraAuthorization(secret: string): string | null {
  return splitJiraSecret(secret) === null
    ? null
    : `Basic ${Buffer.from(secret, 'utf8').toString('base64')}`;
}

/**
 * Seals a new token against a Jira connection and keeps the account email.
 *
 * Retyping a token never changes whose account it is, so the email comes from
 * the stored secret and the caller supplies the token alone. This sits here
 * and not in the route because opening the stored secret is `secretFor`'s job
 * and a route may not import it. Throws when the connection holds no secret.
 */
export async function replaceJiraToken(
  client: ClientBase,
  id: string,
  token: string,
  dates: CredentialDates = {},
): Promise<void> {
  const old = await secretFor(client, id);
  const parts = old === null ? null : splitJiraSecret(old);
  if (parts === null) {
    throw new Error(`connection ${id} holds no Jira email to keep.`);
  }
  await setCredential(client, id, jiraSecret(parts.email, token), dates);
}
