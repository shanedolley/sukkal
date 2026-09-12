# Nabium pushes the payload over a signed webhook

Nabium captures and transcribes meetings on Shane's Mac, and Sukkal needs that
material on amaterasu. ADR-0003 had nabium push a session id over the LAN,
after which Sukkal read the detail from nabium's Postgres through a read-only
role. This decision moves the payload onto the push itself: nabium signs its
whole delivery with a shared secret and posts it to a Sukkal endpoint, and the
read-only role goes away once nabium sends payloads this way. Decided by Shane
on 2 September 2026.

This supersedes ADR-0003. Two things in that decision no longer hold. First,
ADR-0009 made Sukkal the product other people install, and a read-only role on
Shane's Mac cannot be granted to somebody else's box, so the design served one
person only. Second, the accepted risk "nabium's migrations can break Sukkal
silently" stops being accepted: a payload is a contract that can be versioned,
so a breaking change becomes a failed post rather than a silent wrong read.

ADR-0008 refused a Jira webhook partly because accepting one would need a
bypass on a public path, and Cloudflare Access should stay closed. Nabium's
webhook escapes that refusal only because nabium and amaterasu share a LAN:
the delivery never crosses the Cloudflare tunnel Access guards, so no bypass
is needed anywhere. An inbound webhook reachable from the public internet
would face the same refusal ADR-0008 gives Jira.

## Considered Options

1. **Keep the read-only role** - the status quo ADR-0003 set up. Rejected for
   the two reasons above: it cannot be granted to a second installation, and it
   leaves the schema-coupling risk unmitigated.
2. **A documented HTTP API in both directions** - ADR-0003 already rejected
   this shape as two sides to build and version for one consumer. Nothing here
   changes that math; the traffic still runs one way, from nabium to Sukkal, and a
   single signed endpoint covers it.
3. **Sukkal polls an endpoint nabium exposes** - inverts the direction back onto
   nabium running a server on the LAN, which trades one credential problem for
   another and adds latency nabium's own event does not need. Rejected because
   nabium already knows the moment a session is ready; pushing costs it nothing
   extra.
4. **A public webhook behind Cloudflare Access, the shape ADR-0008 refused for
   Jira** - rejected for the same reason ADR-0008 gives: an inbound webhook is
   an unauthenticated POST until its own signature proves otherwise, so putting
   one on a public path needs a bypass in Access, and Access is the layer the
   design leans on hardest. Nabium's endpoint is not this option: it answers
   only on the LAN amaterasu already trusts, and Access never sees the request.
5. **A signed webhook on the LAN, nabium holds the secret** - chosen. The
   sender signs the raw body with a shared secret; the receiver checks the
   signature in constant time, checks a size cap before it parses anything, and
   fails closed when it holds no secret at all. A delivery id makes a retry a
   no-op rather than a duplicate.

## Consequences

- Trust reverses. Sukkal held a credential on nabium's database before; afterwards
  nabium holds one secret and Sukkal opens nothing outbound to reach it.
- The endpoint stores the body verbatim and parses only the two fields the
  contract names, `event` and `sessionId`. Nabium owns the shape, matching the
  rule the `sources` table already obeys: a receiver that interprets on the way
  in loses whatever it failed to understand.
- Retiring the read-only role waits until nabium actually sends payloads this
  way. Until then both paths exist side by side.
- ADR-0003's best property, that a missed push costs nothing because Sukkal can
  replay from nabium's database, does not carry over. A webhook alone loses a
  delivery nabium never retries. The catch-up path that property needs is out
  of scope here and needs its own story before the read-only role can retire.
- The web tier gains its first database access. It reaches `src/db/connect.ts`
  across the package boundary between the root project and `apps/web`. That
  import rested on nothing when this decision was taken: `apps/web` was its own
  npm package with its own lockfile and its own `node_modules`, and the import
  resolved only because a second install happened to leave `pg` at the root.
  **KPA-68 closed this on 3 September 2026.** `apps/web` is now a workspace of
  the root package, so one `npm install` at the root installs both and hoists
  one copy of `pg` that both packages resolve. The web job in
  `.github/workflows/ci.yml` runs one `npm ci` and proves the route builds from
  a clean checkout.
- A worker reads the backlog this endpoint fills. That is KPA-55, out of scope
  here.
