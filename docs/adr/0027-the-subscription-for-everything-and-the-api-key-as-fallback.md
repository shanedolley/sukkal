# The subscription for everything, the API key as the fallback

Sukkal calls Claude through Shane's subscription for every workload, scheduled
and interactive. The metered API key is the fallback. Shane ruled this on
19 October 2026: "I use Claude via subscription, not by API key." This
supersedes ADR-0016, which gave chat to the API and the scheduled jobs to the
subscription.

## What is built

- **The credential.** `claude setup-token` runs on Shane's machine and prints a
  long-lived token. He pastes it into the Subscription method on the Claude
  card. `src/connections/store.ts` seals it like every other credential. No
  route, log line or screen returns it.
- **The call.** `src/memory/inference-live.ts` runs the official Claude Code CLI
  headless (`claude -p --output-format json`) with every tool off. The prompt
  goes in on stdin. The token goes only in the child's environment, as
  `CLAUDE_CODE_OAUTH_TOKEN`. The child gets an allow-listed environment (`PATH`,
  `HOME`, `USER`, `TMPDIR`, `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`), so
  `ANTHROPIC_API_KEY`, `DATABASE_URL` and `SUKKAL_SECRET_KEY` never reach it.
- **The fallback.** The API key connection answers through the Messages API when
  no subscription credential exists, or when the subscription call fails with an
  authentication or rate-limit error. Any other failure throws, so a network
  fault never spends money. With neither credential the call throws a message
  that says where to add one.
- **The setting.** `SUKKAL_INFERENCE` is `subscription` (the default) or `api`.
  It orders the two paths, and the other is the fallback. No call site chooses.
- **The probe.** The hourly recheck proves a subscription token with one small
  Haiku call through the same CLI. `src/connections/recheck.ts` never sends the
  token to `probeFor`, which would have posted it to `api.anthropic.com` as an
  API key.

## Rule: the token never reaches api.anthropic.com from Sukkal's code

Anthropic permits a subscription token through its own Claude Code tools. Sukkal
therefore never sends the token over HTTP itself. Past the route that seals it,
the only code that opens it is the worker, which puts it in the child's
environment.

## Considered Options

1. **The CLI, headless** - chosen. Anthropic documents `claude setup-token` and
   `CLAUDE_CODE_OAUTH_TOKEN` for scripts and CI. It adds no dependency. The
   Docker image pins one version.
2. **`@anthropic-ai/claude-agent-sdk`** - lost. It runs the same binary, bundles
   a native copy per platform, and its documentation steers authentication to API
   keys. It would add a dependency and a lockfile change to run one process with
   tools off. The CLI is the same engine without them.
3. **Call the API with the OAuth token** - forbidden. Anthropic does not permit
   it outside its own tools.
4. **Capture a token at sign-in** - impossible. Anthropic offers no OAuth client
   to a third party, and signing in at claude.ai grants Sukkal nothing. That is
   why the old Subscription button captured nothing.
5. **ADR-0016's split by workload** - superseded. Its concern was real: the
   brief's *Risks accepted* says an always-on use of a coding tool meets rate
   limits. The fallback answers that concern. Chat on a limit moves to the API
   key instead of failing.

## Consequences

- **The brief's risk now covers chat.** A rate limit on the subscription costs
  tokens on the API key rather than a broken screen. A deployment with no API key
  has no fallback and the call throws.
- **Every call spawns a process.** Startup adds about a second, so a gate or a
  chat turn is slower than a direct API call.
- **The CLI sends its default system prompt.** The default prompt describes a
  coding assistant. A gate prompt that depends on a different persona needs a
  `--system-prompt` and a test.
- **The token expires.** The card asks for a Review by date, as it does for a
  key. A revoked or lapsed token turns the hourly check red and sends calls to
  the API key.
- **Usage policy.** Anthropic's policy bars a developer from collecting, storing
  or intermediating Claude.ai credentials for users. Here the owner pastes his
  own token into his own installation, and the unmodified binary is the only
  thing that uses it. That reading holds for Shane's installation. Read the
  policy again before anyone else runs Sukkal on a subscription (ADR-0009).
- **The image carries the CLI.** The Dockerfile installs `@anthropic-ai/claude-code`
  at an exact version and turns its updater off. The root filesystem is read
  only, so the CLI's config directory lives on the `/tmp` tmpfs.
- **Nothing calls `live` yet.** Gates 1 and 2, the briefing's answer and mail
  classification still run on `recorded` in the tests and on nothing in the
  worker. The story that wires the first caller reads the setting and the
  credential through `storedSecret`.
