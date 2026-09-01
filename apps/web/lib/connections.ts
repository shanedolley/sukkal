"use client";

// The accounts the assistant reaches a provider with.
//
// One provider, many accounts. Shane holds a Microsoft account at BHP and
// another at Sydney Water, and the two share nothing but the provider. So the
// connection carries the name, and the provider is a field on it rather than
// the identity of it. Adding the same provider twice is the normal case here,
// not a mistake to guard against.
//
// A secret is never stored. localStorage is readable by anything that runs on
// the page and travels with the browser profile, so a key written here would
// be a key given away. The saved list holds names and choices only, and the
// worker takes the credential when it exists.
//
// ponytail: the third JSON-in-localStorage store, after lib/project-fields.ts
// and lib/project-settings.ts. A shared helper in lib/local-store.ts is now
// due, and this file is the one that should move to it first.

import { createLocalStore } from "./local-store";
import type { ProviderId } from "./providers";

export interface Connection {
  id: string;
  provider: ProviderId;
  /** What this account is called, such as "BHP Microsoft". */
  name: string;
  /** The id of the chosen method. */
  method: string;
  /** Service ids. Empty when the provider carries one thing. */
  services: string[];
}

function parse(value: string): Connection[] {
  try {
    const read: unknown = JSON.parse(value);
    return Array.isArray(read) ? (read as Connection[]) : [];
  } catch {
    return [];
  }
}

const KEY_NAME = "kpa.connections";

const store = createLocalStore<string>(KEY_NAME, "[]", (value) => {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
});

/** Every connection, in the order they were added. */
export function useConnections(): Connection[] {
  return parse(store.useValue());
}

function current(): Connection[] {
  if (typeof window === "undefined") return [];
  return parse(window.localStorage.getItem(KEY_NAME) ?? "[]");
}

/** Add one account. The id is unique, because two accounts share a name. */
export function addConnection(connection: Omit<Connection, "id">) {
  const id = `${connection.provider}-${Date.now().toString(36)}`;
  store.set(JSON.stringify([...current(), { ...connection, id }]));
}

export function removeConnection(id: string) {
  store.set(JSON.stringify(current().filter((entry) => entry.id !== id)));
}
