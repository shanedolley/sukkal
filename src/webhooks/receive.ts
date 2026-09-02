/**
 * The one place an inbound webhook is authenticated and taken.
 *
 * A sender posts a body and a signature. This module decides whether to
 * believe the signature, whether the body carries the two fields the contract
 * names, and then writes the body verbatim to `inbound_deliveries`. It parses
 * nothing else. The sender owns the shape, and a worker reads it later.
 *
 * Every path fails closed. An unset secret refuses the request rather than
 * accepting it unsigned, because a receiver that accepts anything while its
 * configuration is half-finished is worse than one that is plainly down.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ClientBase } from 'pg';

/** How the signature header is written: the algorithm, then the digest. */
const PREFIX = 'sha256=';

/**
 * The largest body the receiver will read.
 *
 * A meeting transcript is the biggest thing nabium sends, and a long meeting
 * runs to a few hundred kilobytes of text. Five megabytes leaves room for an
 * order of magnitude and still refuses a body that could exhaust the process.
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Why a delivery was refused. The caller maps these to a status code. */
export type Refusal =
  | 'no-secret'
  | 'no-signature'
  | 'bad-signature'
  | 'too-large'
  | 'bad-json'
  | 'bad-payload'
  | 'no-delivery-id';

export interface Accepted {
  ok: true;
  /** False when this delivery id had already arrived. */
  stored: boolean;
  deliveryId: string;
  event: string;
}

export interface Refused {
  ok: false;
  refusal: Refusal;
  /** Safe to return to the sender. It names no secret and echoes no body. */
  detail: string;
}

export type Result = Accepted | Refused;

/**
 * Whether `signature` is any of these secrets' HMAC over `body`.
 *
 * The comparison is timing safe. A byte-by-byte compare that returns early
 * leaks how much of a guess was right, which is enough to find the rest one
 * byte at a time.
 *
 * Constant time against a list means one thing more: the loop tries every
 * secret and answers at the end. A loop stopping at the first match answers
 * faster for a delivery signed with the first secret than for one signed with
 * the second, and during a rotation that difference names which secret the
 * sender holds. The bitwise `|=` is what keeps it. `||` stops evaluating once
 * a term is true, so it would restore the early exit.
 *
 * Every SHA-256 digest is 32 bytes, whatever the secret's length, so the
 * length check below answers the same way for every secret. It rejects the
 * length the caller sent, which the caller already knows.
 */
export function signatureMatches(
  body: string,
  signature: string,
  secrets: readonly string[],
): boolean {
  if (!signature.startsWith(PREFIX)) return false;

  const offered = Buffer.from(signature.slice(PREFIX.length), 'hex');
  let matched = 0;

  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(body, 'utf8').digest();
    // timingSafeEqual throws on a length mismatch, which would itself be a
    // signal. A hex digest of the wrong length cannot be right, so answer here.
    const same = offered.length === expected.length && timingSafeEqual(offered, expected);
    matched |= same ? 1 : 0;
  }

  return matched === 1;
}

/** What the receiver signs and stores for a sender. */
export function sign(body: string, secret: string): string {
  return PREFIX + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * The two fields the contract names, and the only two this module reads.
 *
 * `event` says what happened and `sessionId` identifies the thing it happened
 * to. Everything else in the body passes through untouched.
 */
function contractHolds(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const body = payload as Record<string, unknown>;
  return (
    typeof body.event === 'string' &&
    body.event.trim().length > 0 &&
    typeof body.sessionId === 'string' &&
    body.sessionId.trim().length > 0
  );
}

export interface Delivery {
  /** The sender. Written to the `source` column. */
  source: string;
  /** The sender's idempotency key, from its own header. */
  deliveryId: string;
  /** The raw request body, exactly as the signature was computed over it. */
  body: string;
  /** The signature header the sender offered. */
  signature: string | null;
  /**
   * Every shared secret this sender may sign with. A signature matching any
   * one of them is accepted, so a rotation can hold the old secret and the new
   * one at once and drop no delivery. An empty entry is not a secret, and a
   * list holding no secret at all refuses the delivery.
   */
  secrets: readonly string[];
}

/**
 * Authenticates a delivery and stores it.
 *
 * The order matters. Size before parse, so a huge body is refused before it is
 * read into an object. Signature before parse, so an unauthenticated body is
 * never interpreted at all.
 */
export async function receive(
  client: ClientBase,
  delivery: Delivery,
): Promise<Result> {
  // An empty entry is not a secret. A variable holding `old,` carries one
  // secret and a stray comma, and the empty half must authenticate nothing.
  const secrets = delivery.secrets.filter((secret) => secret.trim().length > 0);

  if (secrets.length === 0) {
    return {
      ok: false,
      refusal: 'no-secret',
      detail: 'This receiver holds no shared secret, so it can authenticate nothing.',
    };
  }

  if (Buffer.byteLength(delivery.body, 'utf8') > MAX_BODY_BYTES) {
    return {
      ok: false,
      refusal: 'too-large',
      detail: `The body exceeds ${MAX_BODY_BYTES} bytes.`,
    };
  }

  if (!delivery.signature) {
    return {
      ok: false,
      refusal: 'no-signature',
      detail: 'The request carried no signature header.',
    };
  }

  if (!signatureMatches(delivery.body, delivery.signature, secrets)) {
    return {
      ok: false,
      refusal: 'bad-signature',
      detail: 'The signature does not match the body.',
    };
  }

  if (delivery.deliveryId.trim().length === 0) {
    return {
      ok: false,
      refusal: 'no-delivery-id',
      detail: 'The request carried no delivery id, so a retry could not be recognised.',
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(delivery.body);
  } catch {
    return { ok: false, refusal: 'bad-json', detail: 'The body is not JSON.' };
  }

  if (!contractHolds(payload)) {
    return {
      ok: false,
      refusal: 'bad-payload',
      detail: 'The body needs a non-empty event and a non-empty sessionId.',
    };
  }

  // ON CONFLICT is the whole retry story. A sender that repeats a delivery id
  // writes nothing twice, and learns so from `stored`.
  const stored = await client.query(
    `INSERT INTO inbound_deliveries (source, delivery_id, event, payload)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (source, delivery_id) DO NOTHING
       RETURNING id`,
    [delivery.source, delivery.deliveryId.trim(), payload.event, delivery.body],
  );

  return {
    ok: true,
    stored: stored.rowCount === 1,
    deliveryId: delivery.deliveryId.trim(),
    event: payload.event as string,
  };
}

/** The status a refusal earns. A bad secret is ours; everything else is theirs. */
export function statusFor(result: Result): number {
  if (result.ok) return result.stored ? 202 : 200;
  switch (result.refusal) {
    case 'no-secret':
      return 503;
    case 'no-signature':
    case 'bad-signature':
      return 401;
    case 'too-large':
      return 413;
    default:
      return 400;
  }
}
