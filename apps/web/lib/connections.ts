"use client";

// The accounts the assistant reaches a provider with.
//
// One provider, many accounts. Shane holds a Microsoft account at BHP and
// another at Sydney Water, and the two share nothing but the provider. So the
// connection carries the name, and the provider is a field on it rather than
// the identity of it. Adding the same provider twice is the normal case here,
// not a mistake to guard against.
//
// THE SECRET GOES THROUGH THIS MODULE AND IS HELD BY NONE OF IT. `add` puts
// the typed key in the request body, and nothing keeps it afterwards: no
// state, no storage, and no field on what comes back. `listConnections` in
// `src/connections/store.ts` names its columns, so the read cannot carry a
// secret out, and `hasSecret` is how far it goes toward one.
//
// The list was a `localStorage` store until KPA-127, and its own header
// admitted the problem: a key written to this browser is a key given away, so
// the screen collected a credential and dropped it. ADR-0022 sends the whole
// record to the server rather than leaving a connection with two masters.

import { createRemoteStore, send } from "./remote-store";
import type { ProviderId } from "./providers";

const URL = "/api/connections";

/** A connection as this screen may see it. The secret is not in it. */
export interface Connection {
  id: string;
  provider: ProviderId;
  /** What this account is called, such as "BHP Microsoft". */
  name: string;
  /** The id of the chosen method. */
  method: string;
  /** Service ids. Empty when the provider carries one thing. */
  services: string[];
  /** Whether a sealed secret is stored against it. */
  hasSecret: boolean;
  /** Calendar dates, as 'YYYY-MM-DD' text. Null when the provider names none. */
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedOn: string | null;
  verdict: string | null;
  /** Whether the hourly recheck last found it working. Null until it has run. */
  verifiedOk: boolean | null;
}

/** What the dialog collected. The secret is passed on and never kept. */
export interface NewConnection {
  provider: ProviderId;
  name: string;
  method: string;
  services: string[];
  /** The key that was typed, when the method asked for one. */
  secret?: string;
  /** The date the provider's key runs out, when the form asked for it. */
  expiresOn?: string | null;
  /**
   * The address the mail comes from, on a provider that sends. The name above
   * it is the display name recipients read beside it, so the pair reads
   * "Sukkal Resend <no-reply@sukkal.app>". KPA-158.
   */
  sendFrom?: string | null;
}

const store = createRemoteStore<Connection[]>(URL, []);

/** Every connection, in the order the server returns them. */
export function useConnections(): Connection[] {
  return store.useValue();
}

/** Reads the connections again, so a screen left open learns what the hourly
 *  recheck found without a reload. */
export function reloadConnections(): Promise<void> {
  return store.reload();
}

/** Adds one account, with its key when the method took one. */
export function addConnection(connection: NewConnection): void {
  void send(store, URL, "POST", connection);
}

/**
 * Removes one account, and answers why not when the server refused.
 *
 * A provider is told before the row goes, and a provider that does not agree
 * leaves the connection standing. So this one write reports itself, where the
 * two above are content to reload and show what the server now holds.
 */
export function removeConnection(id: string): Promise<string | null> {
  return send(store, `${URL}?id=${encodeURIComponent(id)}`, "DELETE");
}

/**
 * Reconnects a standing row by sealing a new key against it. KPA-159.
 *
 * `addConnection` cannot do this: it inserts, and the table refuses a second
 * row on the same provider and name. This calls PATCH instead, which replaces
 * the credential and keeps the row's id and created_at.
 */
export function replaceKey(
  id: string,
  secret: string,
  expiresOn: string | null
): Promise<string | null> {
  return send(store, `${URL}?id=${encodeURIComponent(id)}`, "PATCH", {
    secret,
    expiresOn,
  });
}

/**
 * Renames a connection whose method takes a key. KPA-162.
 *
 * A grant method's name is the account the provider reported, matched by
 * `connectionNamed` in `src/connections/store.ts` on every later grant, so
 * the route refuses to rename one and this is never called for one.
 */
export function renameConnection(id: string, name: string): Promise<string | null> {
  return send(store, `${URL}?id=${encodeURIComponent(id)}`, "PATCH", { name });
}
