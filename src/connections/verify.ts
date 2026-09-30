/**
 * One cheap authenticated call per provider, and what it answered.
 *
 * A credential rots quietly. A key is revoked, a plan lapses, a token reaches
 * the expiry Atlassian now sets, and nothing says so until a job fails at
 * three in the morning. `connection_credentials` carries `verified_on` and
 * `verdict` for that reason, and this is what fills them.
 *
 * THE PROBE IS DATA AND THE CALL IS NOT. `probeFor` builds a request and
 * reaches nothing, so a test reads the URL, the method and the header shape
 * without a network. `verify` takes the fetcher as an argument, so the same
 * test drives every answer a vendor can give. Only the caller that passes the
 * real `fetch` touches a vendor.
 *
 * NOTHING HERE LOGS A SECRET. The key goes into a header and never into a URL,
 * because a URL reaches the vendor's access log and this project's own. The
 * verdict is written for a person to read and names no key.
 *
 * WHAT COUNTS AS CHEAP. Four of the five probes cost nothing: they ask who
 * the key belongs to rather than for work. Voyage publishes no such endpoint,
 * so the cheapest authenticated call it offers is an embedding of one short
 * string, and it is metered. `Probe.cost` says which is which, so a scheduled
 * re-verification can skip what it would pay for. KPA-107 is where that
 * schedule lands.
 */

/** What a verification would send. It holds a secret and is never logged. */
export interface Probe {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /**
   * `free` asks the vendor who the key belongs to. `metered` asks for work
   * and the vendor bills it, however little.
   */
  cost: 'free' | 'metered';
  /** What the call asks, for the verdict and for a reader of this file. */
  asks: string;
}

/** What a verification found. `verdict` is what the row stores. */
export interface Verdict {
  ok: boolean;
  verdict: string;
}

/** The model a Voyage probe embeds with. `src/embedding.ts` pins the real
 *  one, and this asks for the smallest answer rather than a useful one. */
const VOYAGE_PROBE_MODEL = 'voyage-4';

/**
 * The call that proves a key for `provider`, or null when nothing can.
 *
 * A method holding no secret is one of the nulls: Claude's subscription signs
 * in through a browser and stores no key, so there is nothing to authenticate
 * with and nothing to verify. The caller records that rather than treating it
 * as a failure.
 */
export function probeFor(provider: string, secret: string): Probe | null {
  if (secret.trim() === '') return null;

  switch (provider) {
    case 'openrouter':
      return {
        url: 'https://openrouter.ai/api/v1/key',
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
        cost: 'free',
        asks: 'what this key is and what is left on it',
      };

    case 'claude':
      // The model list is authenticated and spends no tokens. Asking a model
      // to answer would prove the same thing and bill for it.
      return {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        method: 'GET',
        headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
        cost: 'free',
        asks: 'whether the key may list models',
      };

    case 'linear':
      return {
        url: 'https://api.linear.app/graphql',
        method: 'POST',
        headers: { authorization: secret, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ viewer { id } }' }),
        cost: 'free',
        asks: 'who the key belongs to',
      };

    case 'resend':
      // The key list is the only free authenticated call Resend publishes.
      // Everything else it offers either sends a message, which bills and
      // mails a real person, or needs an id from a message already sent.
      //
      // IT NEEDS A FULL-ACCESS KEY. Resend's other permission is
      // `sending_access`, which "can only send emails", so such a key sends
      // the reset link and is refused here. The card's hint says to make a
      // full-access key for that reason, and a sending-only one reads as
      // refused rather than as unchecked.
      return {
        url: 'https://api.resend.com/api-keys',
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
        cost: 'free',
        asks: 'whether the key may list the keys on its account',
      };

    case 'voyage':
      // Voyage publishes no endpoint that names a key, so the cheapest
      // authenticated call is the smallest embedding it will make. One short
      // string is a fraction of a cent and it is not nothing, which is what
      // `cost` records.
      return {
        url: 'https://api.voyageai.com/v1/embeddings',
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ input: ['ok'], model: VOYAGE_PROBE_MODEL }),
        cost: 'metered',
        asks: 'whether the key may embed',
      };

    default:
      return null;
  }
}

/** How a vendor's status reads to somebody deciding what to do about it. */
function readStatus(status: number): { ok: boolean; says: string } {
  if (status >= 200 && status < 300) return { ok: true, says: 'accepted' };
  if (status === 401 || status === 403) {
    return { ok: false, says: 'refused the key' };
  }
  if (status === 404) return { ok: false, says: 'has no such endpoint' };
  if (status === 429) return { ok: false, says: 'is rate limiting' };
  if (status >= 500) return { ok: false, says: 'is failing' };
  return { ok: false, says: `answered ${String(status)}` };
}

/**
 * Runs `probe` and says what the vendor answered.
 *
 * It never throws. A vendor that is down, a DNS failure and a refused key are
 * all answers worth storing, and a throw here would leave the row saying the
 * credential was never checked. The distinction a reader needs is in `ok`.
 *
 * `fetcher` is an argument so a test drives every answer without a network.
 */
export async function verify(
  probe: Probe,
  fetcher: typeof fetch = fetch,
): Promise<Verdict> {
  try {
    const answer = await fetcher(probe.url, {
      method: probe.method,
      headers: probe.headers,
      ...(probe.body === undefined ? {} : { body: probe.body }),
    });
    const read = readStatus(answer.status);
    return { ok: read.ok, verdict: `${new URL(probe.url).host} ${read.says}` };
  } catch (cause) {
    // The message names the host and not the request, because the request
    // carries the key in a header.
    const why = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, verdict: `${new URL(probe.url).host} could not be reached: ${why}` };
  }
}
