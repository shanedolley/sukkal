/**
 * The live `Inference`: Shane's Claude subscription first, the API key second.
 * ADR-0027. KPA-86.
 *
 * THE SUBSCRIPTION GOES THROUGH THE CLAUDE CODE CLI AND NOTHING ELSE.
 * Anthropic permits a subscription token only inside its own tools, so this
 * module never sends that token over HTTP. `viaCli` hands it to
 * `claude -p` in the child's environment as `CLAUDE_CODE_OAUTH_TOKEN`, and the
 * only network call in this file, `viaMessages`, carries the API key.
 *
 * NO PLACE BUT THAT ONE VARIABLE HOLDS THE TOKEN. It is not in an argument,
 * because `ps` shows arguments to every user on the box. It is not in a log
 * line, because this module logs the kind of a failure and never its text. A
 * message the child wrote is scrubbed of the token before it enters an error.
 * The child's environment is an allow-list rather than a copy of ours, so
 * `ANTHROPIC_API_KEY` cannot outrank the token and `DATABASE_URL` and
 * `SUKKAL_SECRET_KEY` never reach a process that has no use for them.
 *
 * THE SETTING ORDERS THE TWO PATHS AND THE CALL SITE NEVER CHOOSES.
 * `SUKKAL_INFERENCE` is `subscription` (the default) or `api`. The path that
 * is not first is the fallback. A path with no stored credential is skipped,
 * and a path that fails with an authentication or rate-limit error hands over
 * to the next. Any other failure throws without moving on, so a network fault
 * or a crashed child never spends money on the API key.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { ClientBase } from 'pg';

import { connectionWithSecret, secretFor } from '../connections/store.ts';
import type { Inference } from './inference.ts';

export type Path = 'subscription' | 'api';

/** Which `claude` connection method holds each path's credential. */
const METHOD: Record<Path, string> = { subscription: 'subscription', api: 'key' };

/**
 * The one model both paths ask for, so the setting changes who pays and never
 * what answers. The CLI accepts a full model name.
 */
export const MODEL = 'claude-sonnet-5-5';

/** A gate answers PASS or FAIL and a sentence. Chat is the long answer. */
const MAX_TOKENS = 4096;

/** The longest a child may run. A hung process must not hold the worker. */
const TIMEOUT_MS = 120_000;

/** What a failure was, as far as the fallback cares. */
export type Kind = 'auth' | 'rate_limit' | 'other';

export class InferenceError extends Error {
  readonly kind: Kind;

  constructor(kind: Kind, message: string) {
    super(message);
    this.name = 'InferenceError';
    this.kind = kind;
  }
}

function kindOf(status: number | null, said: string): Kind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || status === 529) return 'rate_limit';
  if (/authenticat|oauth|log ?in|unauthori[sz]ed|invalid api key|revoked/i.test(said)) {
    return 'auth';
  }
  if (/rate.?limit|usage limit|limit reached|too many requests|overloaded|limiting requests/i.test(said)) {
    return 'rate_limit';
  }
  return 'other';
}

/** What a finished child left behind. */
export interface Child {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs one process to the end. The seam a test replaces with a fake child. */
export type Runner = (
  command: string,
  args: string[],
  options: { input: string; env: Record<string, string>; timeoutMs?: number | undefined },
) => Promise<Child>;

/** The real runner. The prompt arrives on stdin, never in the arguments. */
export const spawnChild: Runner = (command, args, { input, env, timeoutMs = TIMEOUT_MS }) =>
  new Promise((resolve, reject) => {
    // Out of the repository, so no CLAUDE.md or settings file of ours is read.
    // The signal kills a child that outlives the timeout, and its timer does not
    // keep the process alive, which `spawn`'s own `timeout` option does when the
    // binary is missing.
    const child = spawn(command, args, {
      env,
      cwd: tmpdir(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    // A child that exits before it reads the prompt closes the pipe on us.
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });

/**
 * What the child may see of ours. The token is added by `viaCli` alone.
 *
 * `USER` is there for a developer machine: on macOS the CLI finds its stored
 * login in the Keychain by user name, and answers "Not logged in" without it.
 * A deployed installation signs in with the token and needs neither.
 */
const KEPT = ['PATH', 'HOME', 'USER', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER'];

function childEnv(token: string | null): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of KEPT) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (token !== null) env['CLAUDE_CODE_OAUTH_TOKEN'] = token;
  return env;
}

/**
 * One answer from `claude -p`.
 *
 * `token` is null only on a developer machine that is signed in to the CLI
 * already, which is how the live proof for this module ran. A deployed
 * installation always passes the stored setup token.
 *
 * Every tool is off and nothing is saved, so the child is a completion and
 * cannot touch a file. `--safe-mode` loads no hook, skill, plugin or CLAUDE.md,
 * and authentication works as usual under it. `--bare` would be the stricter
 * flag and it ignores the OAuth token, so it cannot be used.
 */
export async function viaCli(
  token: string | null,
  prompt: string,
  options: { run?: Runner | undefined; model?: string | undefined } = {},
): Promise<string> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--safe-mode',
    '--model', options.model ?? MODEL,
  ];
  const run = options.run ?? spawnChild;
  const scrub = (text: string): string => (token === null ? text : text.replaceAll(token, '[token]'));

  let child: Child;
  try {
    child = await run('claude', args, { input: prompt, env: childEnv(token) });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new InferenceError('other', `the claude CLI could not be run: ${scrub(why)}`);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(child.stdout);
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: a crash, a timeout, or a version that prints something else.
  }

  if (child.code === 0 && body?.['is_error'] !== true && typeof body?.['result'] === 'string') {
    return body['result'];
  }

  const said = scrub(
    typeof body?.['result'] === 'string' && body['result'] !== ''
      ? body['result']
      : child.stderr.trim() ||
          (child.code === null ? 'the process was killed or timed out' : `exit code ${String(child.code)}`),
  ).slice(0, 300);
  const status = typeof body?.['api_error_status'] === 'number' ? body['api_error_status'] : null;
  throw new InferenceError(kindOf(status, said), `the claude CLI failed: ${said}`);
}

/** One answer from the Messages API, paid for by the key. */
export async function viaMessages(
  key: string,
  prompt: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const answer = await fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!answer.ok) {
    throw new InferenceError(kindOf(answer.status, ''), `api.anthropic.com answered ${String(answer.status)}`);
  }

  const body = (await answer.json()) as { content?: { type?: string; text?: string }[] };
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  if (text === '') {
    throw new InferenceError('other', 'api.anthropic.com answered with no text.');
  }
  return text;
}

/** The path to try first, from `SUKKAL_INFERENCE`. A value it does not know is
 *  refused, because a typo would otherwise pick a path by accident. */
export function preference(env: NodeJS.ProcessEnv = process.env): Path {
  const value = env['SUKKAL_INFERENCE'] ?? 'subscription';
  if (value !== 'subscription' && value !== 'api') {
    throw new Error(`SUKKAL_INFERENCE is "${value}", and it has to be subscription or api.`);
  }
  return value;
}

/** Opens the stored credential for a path, or answers null when none is
 *  stored. The plaintext is opened here, at the moment of the call. */
export function storedSecret(client: ClientBase): (path: Path) => Promise<string | null> {
  return async (path) => {
    const id = await connectionWithSecret(client, 'claude', METHOD[path]);
    return id === null ? null : secretFor(client, id);
  };
}

export const NOTHING_STORED =
  'no Claude credential is stored. Add the subscription setup token or an API key to the Claude card on the Connections screen.';

/**
 * The live `Inference`. `secretOf` reads one path's credential at call time, so
 * a token typed on the screen is used by the next call and a path is opened
 * only if it is tried.
 */
export function live(
  secretOf: (path: Path) => Promise<string | null>,
  options: { prefer?: Path; run?: Runner | undefined; fetcher?: typeof fetch | undefined } = {},
): Inference {
  const first = options.prefer ?? preference();
  const order: Path[] = first === 'api' ? ['api', 'subscription'] : ['subscription', 'api'];

  return {
    async ask(_name, prompt) {
      const failed: string[] = [];
      const missing: Path[] = [];

      for (const path of order) {
        const secret = await secretOf(path);
        if (secret === null) {
          missing.push(path);
          continue;
        }

        try {
          return path === 'subscription'
            ? await viaCli(secret, prompt, { run: options.run })
            : await viaMessages(secret, prompt, options.fetcher);
        } catch (cause) {
          if (!(cause instanceof InferenceError) || cause.kind === 'other') throw cause;
          // The kind and the path, and never the message: a failure the
          // child wrote might name the credential.
          console.warn(`inference: the ${path} path failed (${cause.kind}), trying the next.`);
          failed.push(`${path}: ${cause.message}`);
        }
      }

      if (failed.length === 0) throw new Error(NOTHING_STORED);
      const alone = missing.length === 0 ? '' : ` Nothing is stored to fall back on for ${missing.join(' or ')}.`;
      throw new Error(`no Claude path answered. ${failed.join('; ')}.${alone}`);
    },
  };
}
