# A nonce per request, and nothing prerendered

The Content-Security-Policy allows inline script by a per-request nonce, and
every route renders on demand. Twelve prerendered routes become dynamic, and
that is the price. Decided on 13 September 2026 while building KPA-148.

KPA-148 asks for the header that stops a stored string running as script.
Sukkal holds strings it did not write, from a nabium delivery, a tracker's issue
description and a mailbox. The policy engine governs what Sukkal sends. Nothing
governed what a screen ran until this.

The choice looked like nonce against hash, and it is not. A hash cannot be
written at all.

## The flight payload is why

Next's own guide offers both, and says a nonce needs dynamic rendering. It does
not say what a hash would have to cover. That was measured instead of assumed,
by reading the rendered HTML of the production build on 13 September 2026.

Every page carries four to six inline `<script>` tags. Three are constant
across all eleven pages read:

| Hash | What it is |
|---|---|
| `sha256-GQqwCJxJkz3kcYVrFnEifkKOqRXWbTyeZz+80e6AX5U=` | The appearance bootstrap, wrapped by `next/script` into `__next_s` |
| `sha256-n46vPwSWuMC0W703pBofImv82Z26xo4LXymv0E9caPk=` | `next-themes`, writing the class before React hydrates |
| `sha256-OBTN3RiyCV4Bq7dFqZ5a2pAXjnCcCYeTJMO2I/LYKeo=` | `(self.__next_f=self.__next_f||[]).push([0])`, 43 bytes |

**The rest are the flight payload, and it carries the page.** Eleven pages
produced sixteen distinct hashes. One dynamic route, `/sprints/[scope]`, gave
eight distinct hashes across three of its own URLs, and only the three constants
were shared.

So a hash list would need one entry per page, and for a dynamic route one entry
per URL, and since the payload embeds rows read at request time, one entry per
state of the database. `next build` cannot compute a hash of something rendered
afterwards. The ordering rules it out rather than the effort.

**Experimental SRI does not reach this either.** The guide offers
`experimental.sri`, which adds an `integrity` attribute to each external
`<script src>` and keeps static generation. It says nothing about inline script,
because SRI covers files. All four to six inline scripts would still be refused.

## So the real choice was the nonce or `'unsafe-inline'`

`'unsafe-inline'` in `script-src` keeps every prerendered route and permits any
inline script, which is the single thing this story exists to refuse. It would
ship the header and not the protection.

**The nonce costs the twelve prerendered routes, and that cost was measured.**
`next start` against `sukkal_local`, ten requests a page, on loopback:

| Page | Prerendered | Dynamic |
|---|---|---|
| `/dashboard` | 6ms mean | 15ms mean |
| `/audit` | 3ms mean | 10ms mean |
| `/settings` | 3ms mean | 10ms mean |

Seven to nine milliseconds a page load. The guide's other warnings are about a
deployment this is not: no CDN stands in front of Sukkal, no edge caches it, and
one person reads it. `proxy.ts` already queries the database on every request
that is not public, so the server was never idle on a prerendered page anyway.

## One line, not twelve

`export const dynamic = "force-dynamic"` in `apps/web/app/layout.tsx` turns all
34 routes dynamic. The alternative was `await connection()` in twelve page
files, which is twelve places for the thirteenth page to forget.

The root layout is where it belongs for a second reason: the nonce is a property
of the response rather than of a page, so no page should have to know about it.

## `style-src` keeps `'unsafe-inline'`, and a nonce could not have helped

A nonce applies to a `<style>` element and never to a `style` attribute. The
rendered HTML carries no `<style>` element at all and 2 to 21 `style` attributes
a page: the sidebar's width custom properties, an `aspect-ratio`, and the colour
swatches on the settings screen, whose values come from the appearance presets.

`'unsafe-hashes'` with a hash per attribute value is the only alternative, and
the swatch values change with the presets. So `style-src` carries
`'unsafe-inline'` whichever way `script-src` goes. It is a far smaller
concession: injected CSS cannot run script.

## Considered Options

1. **A hash of every inline script** - what KPA-148 expected to choose, and it
   keeps the twelve prerendered routes. Rejected because the flight payload is
   page content: sixteen hashes for eleven pages, eight for one route's three
   URLs, and no way to know a dynamic page's hash at build time.

2. **`'unsafe-inline'` in `script-src`** - the guide's own no-nonce example, one
   line of config, nothing given up. Rejected because it permits exactly what
   the story refuses. React escaping is the first layer against a stored string,
   and this header was to be the second.

3. **`experimental.sri`** - keeps static generation and hashes the external
   bundles at build time. Rejected because it covers files and not inline
   script, so every inline script would still be refused. Also experimental,
   which is a poor foundation for the one header that cannot be half-applied.

4. **A nonce, with the twelve routes left prerendered** - rejected because it
   does not work. Next injects the nonce during server rendering, so prerendered
   HTML carries none and its own scripts are refused. The guide says pages
   "build successfully but may encounter runtime errors", which is the worst
   shape of failure: green build, blank page.

## Consequences

- **Nothing is prerendered, and a future page needs no thought.** The root
  layout forces it, so a page added next month is dynamic by having been added.
- **Partial Prerendering is now unavailable**, which the guide states plainly.
  Nothing uses it today.
- **A deployment behind a CDN would cache nothing.** KPA-147 insists on HTTPS
  once there is an address, and whoever raises the deployment story inherits
  this: a CDN in front of Sukkal would serve every page from the origin.
  Reversing it means moving to `'unsafe-inline'` and losing the protection, or
  to hashes and losing nothing because hashes never worked.
- **The three constant hashes are not in the policy.** The nonce covers all four
  to six scripts, so listing them would add nothing, and a `script-src` holding
  any hash makes the browser ignore `'unsafe-inline'`, which is a trap for
  whoever edits the policy next.
- **`'unsafe-eval'` stays out of production.** React uses `eval` in development
  to rebuild server stacks, so the policy adds it when `NODE_ENV` is
  `development` and never otherwise.
- **`frame-ancestors 'none'` replaces nothing.** KPA-146's `X-Frame-Options:
  DENY` stays beside it, because a browser too old for `frame-ancestors` still
  reads the older header.
