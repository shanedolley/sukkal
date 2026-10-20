/**
 * The one place that chooses between the recorded `Inference` and the live one.
 * ADR-0027. KPA-86.
 *
 * `SUKKAL_INFERENCE_MODE` is `live` or `recorded`. Left unset it is `recorded`,
 * so a process nobody configured, which is every test and every continuous
 * integration run, gets an `Inference` that answers from an empty map and calls
 * no model. The cost of that default is that a worker whose environment forgets
 * `live` has every judged gate throw and reject its candidate, and the
 * rejection says so. A value it does not know is refused, because a typo must
 * not pick a mode.
 *
 * `SUKKAL_INFERENCE` is a separate setting: it orders the two live paths. It
 * is read from the same `env` as the mode.
 *
 * ONE EXCEPTION: `verifySubscription` in `src/connections/verify.ts` ignores
 * `SUKKAL_INFERENCE_MODE`. The hourly recheck runs the real `claude` CLI with a
 * small Haiku probe whatever the mode says, because it checks the stored
 * credential and runs no inference. The suite gives it a fake runner.
 *
 * A call site takes its `Inference` from here and never names `live` or
 * `recorded` itself. `test/inference-select.test.ts` fails on a file under
 * `src/`, `scripts/` or `apps/web` that imports the live module or `recorded`,
 * apart from the files it names.
 */
import type { ClientBase } from 'pg';

import { recorded, type Inference } from './inference.ts';
import { live, preference, storedSecret, type Path, type Runner } from './inference-live.ts';

export const MODE_VARIABLE = 'SUKKAL_INFERENCE_MODE';

/** What a test replaces. Each one defaults to the real thing. */
export interface Seams {
  secretOf?: (path: Path) => Promise<string | null>;
  run?: Runner | undefined;
  fetcher?: typeof fetch | undefined;
}

export function inferenceFor(
  client: ClientBase,
  env: NodeJS.ProcessEnv = process.env,
  seams: Seams = {},
): Inference {
  const mode = env[MODE_VARIABLE] ?? 'recorded';
  if (mode === 'live') {
    return live(seams.secretOf ?? storedSecret(client), {
      prefer: preference(env),
      run: seams.run,
      fetcher: seams.fetcher,
    });
  }
  // An empty map, so asking throws "no recorded answer" and the gate rejects.
  if (mode === 'recorded') return recorded({});
  throw new Error(`${MODE_VARIABLE} is "${mode}", and it has to be live or recorded.`);
}
