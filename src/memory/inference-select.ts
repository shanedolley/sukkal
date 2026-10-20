/**
 * The one place that chooses between the recorded `Inference` and the live one.
 * ADR-0027. KPA-86.
 *
 * `SUKKAL_INFERENCE_MODE` is `live` or `recorded`. Left unset it is `recorded`,
 * so a process nobody configured, which is every test and every continuous
 * integration run, can never call a model or spend a credential by accident.
 * The cost of that default is that a worker whose environment forgets `live`
 * has every judged gate throw and reject its candidate, and the rejection says
 * so. A value it does not know is refused, because a typo must not pick a mode.
 *
 * `SUKKAL_INFERENCE` is a separate setting: it orders the two live paths.
 *
 * A call site takes its `Inference` from here and never names `live` or
 * `recorded` itself. `test/inference-select.test.ts` fails on a file that does.
 */
import type { ClientBase } from 'pg';

import { recorded, type Inference } from './inference.ts';
import { live, storedSecret } from './inference-live.ts';

export const MODE_VARIABLE = 'SUKKAL_INFERENCE_MODE';

export function inferenceFor(client: ClientBase, env: NodeJS.ProcessEnv = process.env): Inference {
  const mode = env[MODE_VARIABLE] ?? 'recorded';
  if (mode === 'live') return live(storedSecret(client));
  // An empty map, so asking throws "no recorded answer" and the gate rejects.
  if (mode === 'recorded') return recorded({});
  throw new Error(`${MODE_VARIABLE} is "${mode}", and it has to be live or recorded.`);
}
