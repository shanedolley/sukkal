"use client";

// The browser's copy of the owner's row, read once and shared.
//
// It was a `localStorage` store until KPA-126, and its own header admitted the
// problem: the browser kept no password, so it was honest about storing nothing
// and useless for signing in. Nothing survived a second device or a cleared
// browser either. ADR-0009 gives the installation an account of its own, and
// ADR-0022 sends the chosen colours after it.
//
// ONE FETCH, NOT ONE PER CALLER. Four things want this answer: the app layout,
// the setup wizard, the sign-in form and the appearance provider. The state
// sits in the module rather than in a provider, so the first of them to render
// starts the read and the rest get what it returned. `useSyncExternalStore` is
// what reads it during render, for the reason `local-store.ts` gives.
//
// THE APPEARANCE RIDES ALONG because it is the same row. A second route would
// be a second round trip for one more column.

import { useSyncExternalStore } from "react";

import { isSelection, type Selection } from "./appearance";
import type { Account } from "./owner";

export type { Account };

/** "loading" until the read answers, then "ready" or "error". Never both. */
export type OwnerStatus = "loading" | "ready" | "error";

export interface Owner {
  status: OwnerStatus;
  /** Null when the read says nobody has set this box up. Also null while the
   *  read is in flight and after it fails, which is why `status` exists. */
  account: Account | null;
  /** Null when nobody has picked a colour. */
  appearance: Selection | null;
}

const LOADING: Owner = { status: "loading", account: null, appearance: null };

let owner: Owner = LOADING;
const listeners = new Set<() => void>();
let asked = false;

function put(next: Owner) {
  owner = next;
  for (const listener of listeners) listener();
}

/**
 * Reads the row.
 *
 * A failed read reports "error" rather than "no account". The difference
 * matters: the layout sends a box with no account to the setup wizard, and the
 * wizard writes over the only account on the installation. A database that did
 * not answer must never look like a box nobody has set up.
 */
async function load(): Promise<void> {
  try {
    const response = await fetch("/api/account");
    if (!response.ok) throw new Error(`the read answered ${response.status}`);
    const body = (await response.json()) as {
      account: Account | null;
      appearance: unknown;
    };
    put({
      status: "ready",
      account: body.account,
      appearance: isSelection(body.appearance) ? body.appearance : null,
    });
  } catch (cause) {
    console.error("account:", cause);
    put({ status: "error", account: null, appearance: null });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    void load();
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The owner's row, as far as this browser knows it. */
export function useOwner(): Owner {
  return useSyncExternalStore(subscribe, () => owner, () => LOADING);
}

/** Reads the row again. The wizard calls it, so the layout behind it stops
 *  believing the box has no account. */
export function refresh(): Promise<void> {
  return load();
}

/**
 * Writes the account and waits for it.
 *
 * It throws on a refusal rather than reporting one, because the caller is the
 * wizard and the wizard has a screen to put the reason on.
 */
export async function createAccount(account: {
  name: string;
  email: string;
  assistant: string;
  password: string;
}): Promise<void> {
  const response = await fetch("/api/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `the write answered ${response.status}`);
  }
  await load();
}

/**
 * Saves the chosen colours, and shows them at once.
 *
 * The screen does not wait for the server. A colour applies as the swatch is
 * pressed, which is what it did when the value lived in this browser, and a
 * round trip in front of it would make the picker feel broken. A failed write
 * therefore loses the choice on the next load and reports itself to the
 * console, which is the same trade `local-store.ts` makes for a private window.
 */
export function saveAppearance(selection: Selection): void {
  put({ ...owner, appearance: selection });

  void fetch("/api/account", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appearance: selection }),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`the write answered ${response.status}`);
    })
    .catch((cause: unknown) => console.error("appearance:", cause));
}
