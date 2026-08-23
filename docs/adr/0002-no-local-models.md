# No local models

KPA runs on amaterasu, a 2018 Mac mini with 7.6 GB of RAM and an Intel UHD 630
with no CUDA device, which caps local generation at a 3B model at roughly 10
tokens per second once Postgres and the Node processes have taken their share.
We chose to send all inference to Claude through the subscription CLI, with
OpenRouter as the metered path, rather than run Ollama on the box.

## Considered Options

1. **Local for bulk, cloud for reasoning** - embeddings, transcription and
   classification locally, Claude for anything that reasons. Rejected on 23
   August 2026 in favour of simplicity, and because a RAM upgrade was declined
   for now.
2. **Upgrade to 64 GB first** - the machine takes two DDR4-2666 SO-DIMMs and the
   upgrade costs a few hundred dollars. Deferred, not rejected. It becomes the
   obvious move when Postgres outgrows the current ceiling.

## Consequences

- Every email, transcript and meeting summary reaches a third party, including
  Collibra customer material. See ADR-0004.
- Embeddings need a provider, since Anthropic offers none. Voyage AI was chosen.
- Transcription stays with nabium, which already does it on-device. KPA never
  needs a transcription provider of its own.
- The inference call sits behind an interface, so moving to the Anthropic API
  costs an afternoon rather than a rewrite.
