"use client";

// A value the server holds, read once and shared by every caller.
//
// `local-store.ts` is the same shape over `localStorage`, and the reason for
// `useSyncExternalStore` is the reason it gives: reading in an effect renders
// once with the fallback and again with the answer, which is the cascading
// render the linter refuses, and a separate server snapshot is what keeps the
// server and the first client render in agreement.
//
// ONE FETCH, NOT ONE PER CALLER. Three screens read the connections and four
// read the project tree. The state sits in the module rather than in a
// provider, so the first component to render starts the read and the rest take
// what it returned. `account.ts` wrote this by hand for the owner's row;
// KPA-127 made it the third caller, so it lives here now.
//
// THE FALLBACK COVERS THREE STATES: before the read lands, after it fails, and
// on a box whose database is down. A screen that must tell them apart wants a
// store of its own, as `account.ts` has, because a wizard shown to somebody
// whose database is merely unreachable overwrites the only account there is.

import { useSyncExternalStore } from "react";

export interface RemoteStore<T> {
  useValue: () => T;
  /** What it holds now, outside a render. A setter that changes one entry of
   *  a map needs the other entries. */
  read: () => T;
  /** Reads it again, and waits. */
  reload: () => Promise<void>;
  /** Shows `next` at once, before the server has agreed to it. */
  put: (next: T) => void;
}

export function createRemoteStore<T>(url: string, fallback: T): RemoteStore<T> {
  const listeners = new Set<() => void>();
  let held: T = fallback;
  let asked = false;

  function put(next: T) {
    held = next;
    for (const listener of listeners) listener();
  }

  async function reload(): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`the read answered ${response.status}`);
      put((await response.json()) as T);
    } catch (cause) {
      // The screen keeps the fallback and says nothing. A read that cannot
      // reach the box is the box being down, and every screen here already
      // renders an empty list as "nothing yet".
      console.error(`${url}:`, cause);
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!asked) {
      asked = true;
      void reload();
    }
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    useValue: () =>
      useSyncExternalStore(
        subscribe,
        () => held,
        () => fallback
      ),
    read: () => held,
    reload,
    put,
  };
}

/**
 * Sends a change and reads the answer back.
 *
 * The caller shows its change first, so a write that fails leaves the screen
 * ahead of the server for as long as the page stays open. Reading again puts
 * the two back in agreement, and the console carries the reason. That is the
 * trade `account.ts` makes for the colour picker: a round trip in front of
 * every click makes the screen feel broken.
 */
export async function send<T>(
  store: RemoteStore<T>,
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<void> {
  try {
    const response = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) {
      const said = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(said?.error ?? `the write answered ${response.status}`);
    }
  } catch (cause) {
    console.error(`${method} ${url}:`, cause);
  } finally {
    await store.reload();
  }
}
