// The web tier's one connection pool.
//
// Sixteen screens read this database, so a connection per request costs a
// handshake per read and leaves nothing to reuse. The nabium route opened one
// and closed it, which was honest when it was the only reader. It is not any
// more, and it now takes the pool with everything else.
//
// The pool is built from `src/db/connect.ts` in the root package, which is the
// one place a connection string is read and checked, and the one place the
// date rule is written.
//
// Two properties this file exists for.
//
// It opens once. Next.js reloads a module on every edit in development, so a
// pool held in a module variable alone would leak one per reload until
// Postgres refused the next connection. The pool therefore hangs off
// `globalThis`, which survives the reload.
//
// It opens late. `connectionString` throws when `DATABASE_URL` is unset, and
// a throw at module load would fail `next build`, which reaches no database
// at all. So the pool is built on the first query and never before.

import pg, { Pool } from "pg";

import { connectionString, keepDatesAsText } from "../../../src/db/connect.ts";

// KPA-68 made apps/web a workspace, so npm hoists one copy of the driver and
// `src/db/connect.ts` has already set this parser on the registry below. The
// call is idempotent and it stays as insurance. Let the two `pg` ranges drift,
// npm nests a second copy under apps/web, and a `date` arrives as a `Date` at
// local midnight. Read back as UTC that is a day west of Greenwich: a source
// dated 19 August reads as the 18th from Sydney. Found by reading one, on
// 2 September 2026. Nothing else catches it, because CI's web job unsets
// DATABASE_URL_TEST and no check here reads a real date.
keepDatesAsText(pg.types);

const held = globalThis as typeof globalThis & { kpaPool?: Pool };

export function db(): Pool {
  if (held.kpaPool) return held.kpaPool;

  const pool = new Pool({
    connectionString: connectionString("DATABASE_URL"),
    // Small on purpose. amaterasu has about 5 GB left after the services
    // already on it, and every Postgres connection is a process.
    max: 5,
    application_name: "kpa-web",
  });

  // An idle client that loses its connection emits here. Without a listener
  // node treats it as an unhandled error event and takes the process down,
  // which turns a dropped connection into an outage.
  pool.on("error", (error) => console.error("kpa-web pool:", error));

  held.kpaPool = pool;
  return pool;
}
