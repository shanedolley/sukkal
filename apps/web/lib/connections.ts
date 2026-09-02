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
}

const store = createRemoteStore<Connection[]>(URL, []);

/** Every connection, in the order the server returns them. */
export function useConnections(): Connection[] {
  return store.useValue();
}

/** Adds one account, with its key when the method took one. */
export function addConnection(connection: NewConnection): void {
  void send(store, URL, "POST", connection);
}

export function removeConnection(id: string): void {
  void send(store, `${URL}?id=${encodeURIComponent(id)}`, "DELETE");
}
