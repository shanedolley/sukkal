/**
 * The owner's row: the account this installation signs in with, and the
 * colours that owner picked.
 *
 * Both lived in `localStorage` until KPA-126. ADR-0009 makes the installation
 * authenticate rather than assume the network already did, and a browser holds
 * no password to authenticate against. ADR-0022 then asks of every browser key
 * whether it belongs to the person or to the device, and rules that an accent
 * is taste and follows the person.
 *
 * One row answers both, because `users` already holds the row every `owner_id`
 * points at. Migration 017 added the four account columns and migration 019
 * added `appearance`.
 *
 * `password_hash` is written here and read nowhere. Nothing in this module
 * selects it, and `app/(app)/api/account/route.ts` sends the browser only what
 * `readAccount` returns.
 *
 * The caller hands in the pool, the way every read in this tier does. That also
 * leaves this file with no import that survives type erasure, so a test runs it
 * under plain node.
 */
import type { Pool } from "pg";

import { isSelection, type Selection } from "./appearance.ts";

/** The account, as a screen reads it. */
export interface Account {
  /** What to call the person. `users.name`, seeded before the wizard runs. */
  name: string;
  /** How they sign in, and where a reset link would go. */
  email: string;
  /** What they called the assistant. */
  assistant: string;
  /** ISO timestamp the account was made. */
  created: string;
}

/** What the wizard writes. The password arrives hashed, never typed. */
export interface NewAccount {
  name: string;
  email: string;
  assistant: string;
  passwordHash: string;
}

/**
 * The one row. `users_one_owner_per_installation` holds the table at id 1.
 *
 * Exported because a session names whose it is, and there is one whose. The
 * account route issues one the moment the first boot writes this row.
 */
export const OWNER = 1;

interface AccountRow {
  name: string;
  email: string | null;
  assistant_name: string | null;
  created_at: Date | null;
}

/**
 * The account, or null on a box nobody has set up yet.
 *
 * `users_the_account_is_whole` makes the four columns all null or all set, so
 * one of them answers the question. `email` is the one migration 017 names.
 */
export async function readAccount(pool: Pool): Promise<Account | null> {
  const { rows } = await pool.query<AccountRow>(
    `SELECT name, email, assistant_name, created_at FROM users WHERE id = $1`,
    [OWNER]
  );

  const row = rows[0];
  if (!row || row.email === null) return null;

  // The constraint fills the other three whenever the email is filled. They
  // are still read defensively, because a null here would reach a screen as
  // the word "null" rather than as an error.
  return {
    name: row.name,
    email: row.email,
    assistant: row.assistant_name ?? "",
    created: row.created_at?.toISOString() ?? "",
  };
}

/**
 * Writes the account, all of it, in one statement.
 *
 * `users_the_account_is_whole` refuses a subset, so the four columns move
 * together or not at all. `name` joins them because the seeded row carries a
 * placeholder until somebody says who they are.
 *
 * `created_at` is set here rather than defaulted in the schema. Migration 017
 * says why: a default would date the seeded row with the moment the migration
 * ran, and no account existed then.
 */
export async function writeAccount(pool: Pool, account: NewAccount): Promise<void> {
  await pool.query(
    `UPDATE users
        SET name           = $2,
            email          = $3,
            assistant_name = $4,
            password_hash  = $5,
            created_at     = now()
      WHERE id = $1`,
    [OWNER, account.name, account.email, account.assistant, account.passwordHash]
  );
}

/** The chosen colours, or null when nobody has chosen and when what is stored
 *  names a preset this build no longer offers. */
export async function readAppearance(pool: Pool): Promise<Selection | null> {
  const { rows } = await pool.query<{ appearance: unknown }>(
    `SELECT appearance FROM users WHERE id = $1`,
    [OWNER]
  );

  const saved = rows[0]?.appearance;
  return isSelection(saved) ? saved : null;
}

/** Replaces the chosen colours. The four change together, so they are written
 *  together, which is the shape ADR-0022 argues for. */
export async function writeAppearance(pool: Pool, selection: Selection): Promise<void> {
  await pool.query(`UPDATE users SET appearance = $2 WHERE id = $1`, [
    OWNER,
    selection,
  ]);
}
