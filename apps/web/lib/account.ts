"use client";

// The one account on this installation, and how the application knows it has
// been set up.
//
// The brief has Cloudflare Access and WorkOS authenticating Shane before a
// request arrives, which suits one person running one box. Somebody who pulls
// the container down and runs it on their own server has neither, so the first
// boot has to ask who they are. This is what that first boot writes.
//
// No password is kept. localStorage is readable by anything that runs on the
// page and travels with the browser profile, so a password written here would
// be a password given away, and a hash without a server to check it against
// proves nothing. The setup screen takes one, measures it, and lets it go.
//
// ponytail: the fourth JSON-in-localStorage store. It stands in for the
// server's own account row, and it moves there whole once the server exists.

import { createLocalStore } from "./local-store";

export interface Account {
  /** What to call the person. */
  name: string;
  /** How they sign in, and where a reset link would go. */
  email: string;
  /** What they called the assistant. */
  assistant: string;
  /** ISO date the account was made. */
  created: string;
}

const KEY = "kpa.account";

/**
 * What is in storage, when it is an account.
 *
 * Every field is checked for the shape it claims. Anything in localStorage
 * was put there by something outside this code's control: an earlier version
 * of it, a person with the console open, or a half-written value. A cast
 * without a check hands a caller a string that turns out to be a number.
 */
function parse(value: string): Account | null {
  try {
    const read: unknown = JSON.parse(value);
    if (!read || typeof read !== "object") return null;
    const account = read as Record<string, unknown>;
    const text = (field: string) =>
      typeof account[field] === "string" && account[field].length > 0;
    return text("name") && text("email") && text("assistant") && text("created")
      ? (account as unknown as Account)
      : null;
  } catch {
    return null;
  }
}

const store = createLocalStore<string>(KEY, "", (value) => parse(value) !== null);

/** The account, or null on a box nobody has set up yet. */
export function useAccount(): Account | null {
  return parse(store.useValue());
}

export function setAccount(account: Omit<Account, "created">) {
  store.set(JSON.stringify({ ...account, created: new Date().toISOString() }));
}
