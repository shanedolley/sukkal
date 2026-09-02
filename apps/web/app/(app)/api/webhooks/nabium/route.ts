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
import { connect } from '../../../../../../../src/db/connect';
import { receive, statusFor } from '../../../../../../../src/webhooks/receive';

const SOURCE = 'nabium';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();

  // ponytail: one connection per request, opened and closed here. Nabium is
  // one sender on a LAN, not public traffic, so a pool is not worth building
  // yet. Move to one (or skip the connection when the secret is unset) if
  // volume ever makes that untrue.
  const client = connect('DATABASE_URL');
  await client.connect();
  try {
    const result = await receive(client, {
      source: SOURCE,
      deliveryId: request.headers.get('x-nabium-delivery-id') ?? '',
      body,
      signature: request.headers.get('x-nabium-signature'),
      secret: process.env['NABIUM_WEBHOOK_SECRET'],
    });

    const status = statusFor(result);
    return result.ok
      ? NextResponse.json({ deliveryId: result.deliveryId, stored: result.stored }, { status })
      : NextResponse.json({ error: result.detail }, { status });
  } finally {
    await client.end();
  }
}
