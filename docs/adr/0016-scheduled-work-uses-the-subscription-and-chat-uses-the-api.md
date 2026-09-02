# Scheduled work uses the subscription, chat uses the API

Two implementations sit behind `src/memory/inference.ts`, and the workload
picks between them. The scheduled jobs call the Claude subscription through the
headless CLI. Interactive chat calls the metered API. Decided 2 September 2026.

The brief chose the subscription and then, under *Risks accepted*, wrote the
reason this is split: "Claude Code is sold as a coding tool. A few scheduled
jobs a day is ordinary use. An always-on application calling the CLI on every
request is not, and it will meet rate limits."

Chat is the always-on half of that sentence. The nightly review is the ordinary
half. They are one decision only if you ignore the paragraph that separates
them.

## What each half actually does

The scheduled work is bounded and knows its own size. The four gates run per
candidate during ingestion, the nightly review runs once, and extraction runs
per source. Every one is a batch that finishes, on a machine nobody is waiting
at. The subscription's cost is fixed and its latency does not matter.

Chat is neither. Shane types a question and waits, at whatever hour he asks,
with no bound on how often. A rate limit there is a broken screen rather than a
job that runs an hour later.

## Considered Options

1. **The subscription for everything** - one credential, no marginal cost, and
   the pattern the launchd jobs already prove. Rejected because it puts a
   coding tool behind a screen a person waits at, which is the exact use the
   brief already recorded as a risk.
2. **The metered API for everything** - one path, no branch, and the simplest
   thing to reason about. Rejected because it pays per token for the nightly
   review and the ingestion batches, which is most of the volume and none of
   the urgency. The subscription already covers them at no marginal cost.
3. **Both, selected by workload** - chosen.

## Consequences

- The seam earns itself. `Inference` already exists with one recorded
  implementation for the tests, and this adds two live ones rather than
  changing any call site.
- Selection is configured, never inferred from the call site. A job that wants
  the metered path during a subscription outage changes a setting.
- A second credential exists, so a second thing can expire. The connections
  epic already raises a needs-you item for that, and this makes the chat path
  the one where an expiry is felt immediately.
- The escape hatch the brief named stays open in both directions. If the
  subscription meets a limit on the scheduled work too, that is a setting
  rather than a rewrite.
- Cost becomes visible per workload rather than per month, because only one of
  the two paths bills by the token.
- OpenRouter stays the alternative metered path the brief already names. This
  decides which workload is metered, not which vendor meters it.
