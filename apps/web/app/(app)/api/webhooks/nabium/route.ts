/**
 * The web tier's receiver for nabium's webhook. ADR-0013 records why nabium
 * pushes a signed payload here instead of KPA reading its database.
 *
 * A thin handler, on purpose: it reads the raw body and the two headers
 * nabium sends, then hands everything to `receive` in the root package,
 * which is the one place a delivery is authenticated, checked against the
 * contract, and stored. This file makes no security decision of its own.
 *
 * Getting the raw body matters more here than anywhere else in the
 * application. `request.text()` on the Web standard `Request` Next.js hands
 * a route handler returns the bytes nabium sent. Calling `.json()` instead
 * would parse the body and let this handler re-serialise it, and the
 * signature would then fail against bytes nabium never sent.
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { receive, statusFor } from '../../../../../../../src/webhooks/receive.ts';

const SOURCE = 'nabium';

/**
 * The character that separates one secret from the next in the variable.
 *
 * `openssl rand -base64 32` makes every secret here, and base64 writes only
 * `A-Z`, `a-z`, `0-9`, `+`, `/` and `=`. A comma appears in none of them, so
 * splitting on it can never cut a secret in half. `+`, `/` and `=` each can,
 * which is why the obvious separators are wrong.
 */
const BETWEEN_SECRETS = ',';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  // The pool, since KPA-117. This route opened and closed its own connection
  // while it was the only reader, and sixteen screens have made that untrue.
  // The pool checks out a client for the query and hands it back.
  const client = await db().connect();
  try {
    const result = await receive(client, {
      source: SOURCE,
      deliveryId: request.headers.get('x-nabium-delivery-id') ?? '',
      body,
      signature: request.headers.get('x-nabium-signature'),
      // One variable, one or two secrets. The trim forgives `old, new`, which
      // is how a person writes a list, and `receive` drops what is left empty.
      secrets: (process.env['NABIUM_WEBHOOK_SECRET'] ?? '')
        .split(BETWEEN_SECRETS)
        .map((secret) => secret.trim()),
    });

    const status = statusFor(result);
    return result.ok
      ? NextResponse.json({ deliveryId: result.deliveryId, stored: result.stored }, { status })
      : NextResponse.json({ error: result.detail }, { status });
  } finally {
    client.release();
  }
}
