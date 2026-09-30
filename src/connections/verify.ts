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
  /**
   * A refusal that proves the key is live rather than dead.
   *
   * A vendor that scopes its keys refuses a call the key is not scoped for, and
   * that refusal is not a failure: the key authenticated to be refused. Set
   * this and `verify` reads the answer's `name` before believing the status.
   *
   * BOTH FIELDS HAVE TO MATCH, and Resend is why. It documents
   * `restricted_api_key` twice, at 401 for "This API key is restricted to only
   * send emails" and at 403 for "API key is not active". The identifier alone
   * would call a deactivated key live. Read
   * `https://resend.com/docs/api-reference/errors`.
   *
   * Leave it unset and nothing reads the body, which is what the other four
   * probes want: a body is one more thing to fail on.
   */
  alive?: {
    /** The status that carries the proof, and only that status. */
    status: number;
    /** The `name` the answer must carry, exactly. */
    name: string;
    /** What the verdict says, after the host. */
    says: string;
  };
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
      // A SEND-ONLY KEY IS WHAT SUKKAL ASKS FOR, and it cannot list the keys.
      // Sukkal calls one Resend endpoint ever, `POST /emails`, which
      // `sending_access` permits, so a key scoped to sending does everything
      // the product needs and nothing it does not. Asking for `full_access` to
      // make this probe answer would buy a health indicator with the blast
      // radius of the account, which Shane ruled against on 30 September 2026.
      //
      // So the refusal is the proof. Resend answers 401 `restricted_api_key`,
      // "This API key is restricted to only send emails", and a key has to
      // authenticate to earn that sentence. `alive` below reads it as working.
      return {
        url: 'https://api.resend.com/api-keys',
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
        cost: 'free',
        asks: 'whether the key is live, which a send-only key proves by being refused',
        alive: {
          status: 401,
          name: 'restricted_api_key',
          says: 'holds a live send-only key, which is all Sukkal needs',
        },
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
/**
 * The `name` a vendor's error carries, or null.
 *
 * Resend answers `{ "name": ..., "statusCode": ..., "message": ... }`, and the
 * name is the only field this reads. The message is prose a vendor may reword
 * and the status is already in hand.
 *
 * NULL FOR EVERY FAILURE, because the caller treats null as "not the refusal I
 * named" and falls back to the status. A body that is empty, is not JSON, holds
 * no `name`, or cannot be read at all therefore leaves the refusal a refusal,
 * which is the safe direction: this function can only ever turn a dead
 * credential into a live-looking one by returning a name, so it returns one
 * only when it read one.
 */
async function named(answer: Response): Promise<string | null> {
  try {
    const body: unknown = await answer.json();
    if (typeof body !== 'object' || body === null) return null;
    const name = (body as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

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
    const host = new URL(probe.url).host;

    // A refusal the probe named as proof of a live key. The status is checked
    // first, because Resend reuses one identifier across two statuses and only
    // one of them means the key authenticated.
    if (!read.ok && probe.alive !== undefined && answer.status === probe.alive.status) {
      if ((await named(answer)) === probe.alive.name) {
        return { ok: true, verdict: `${host} ${probe.alive.says}` };
      }
    }

    return { ok: read.ok, verdict: `${host} ${read.says}` };
  } catch (cause) {
    // The message names the host and not the request, because the request
    // carries the key in a header.
    const why = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, verdict: `${new URL(probe.url).host} could not be reached: ${why}` };
  }
}
