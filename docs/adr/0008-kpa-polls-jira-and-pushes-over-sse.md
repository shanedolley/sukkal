# KPA polls Jira and pushes over SSE

The board has to show a change made in Jira without anybody reloading the page.
We chose to poll each Jira site on a pg-boss schedule and push to the open tab
over Server-Sent Events, rather than accept Jira webhooks.

Atlassian closed the webhook REST endpoint to API tokens. `GET
/rest/api/3/webhook` answers `403`, "Only Connect and OAuth 2.0 apps can use
this operation", so registering one needs the admin UI and the Administer Jira
permission on each site. KPA reads boards Shane does not administer.

Polling costs almost nothing. `POST /rest/api/3/search/jql` returned a burst
budget of 200 with 199 left after a single call, so a ten second interval across
two sites spends twelve requests a minute against a per-second allowance.

## Considered Options

1. **Jira webhooks** - lowest latency, and no call spent on a quiet minute.
   Rejected because REST registration refuses an API token, the admin route
   needs a permission Shane lacks on `engineering-collibra.atlassian.net`, and
   an inbound webhook is an unauthenticated POST. Accepting one means a
   Cloudflare Access bypass on a public path, and Access is the layer this
   design leans on hardest.
2. **A WebSocket rather than SSE** - one connection carrying both directions.
   Rejected because the traffic runs one way, SSE reconnects without code, and
   it crosses the Cloudflare tunnel as ordinary HTTP.
3. **The browser polls Jira itself** - no server tier to build. Rejected
   because it puts a Jira credential in the browser, multiplies the calls by
   the number of open tabs, and leaves the cache the agents read unfilled.

## Consequences

- Latency equals the poll interval. Ten seconds is the starting point, and the
  measured headroom allows far shorter if that ever matters.
- JQL compares `updated` to the minute, so a query for everything since the last
  run can miss a write made in the same minute. The poll reaches further back
  than its own interval and discards what it has already seen.
- `GET /rest/api/3/search` now answers `410`. The endpoint is
  `POST /rest/api/3/search/jql`.
- A deleted issue never appears in an `updated` query. Removals need their own
  reconciliation, or a deleted row sits on the board until someone reloads.
- The web tier gains its first route handler. The application has none today,
  and both issue pages read `base: ISSUES` straight from the fixtures.
- `useBoard` already layers the session's drafts, edits and removals above
  `base`, so fresh rows replace `base` and an unsaved edit survives underneath
  it. That edit also masks a remote change to the same field until the person
  resolves it, which is the conflict ADR-0007 leaves to a human.
- Webhooks stay available for any site where Shane holds Administer Jira. They
  would feed the same pipeline and change nothing but the latency.
