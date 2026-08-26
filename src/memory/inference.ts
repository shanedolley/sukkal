/**
 * The one seam in front of every model call.
 *
 * Two reasons, both load bearing. The Claude subscription is a coding tool
 * rather than a service backend, so switching to the API has to cost an
 * afternoon. And gates 1 and 2 call the model on every candidate, so an
 * unmocked test suite would cost money, flake, and meet the rate limit the
 * brief warns about.
 */
export interface Inference {
  /**
   * `name` identifies the prompt; `prompt` is that file rendered. A recorded
   * implementation keys off the first, a live one sends the second.
   */
  ask(name: string, prompt: string): Promise<string>;
}

/**
 * Answers from a fixed map. The tests and continuous integration use this, so
 * the suite passes with the network unavailable and needs no credential.
 *
 * An unrecorded prompt throws, which rejects the candidate. Silence would let
 * a missing fixture read as a pass.
 *
 * ponytail: no live implementation yet. Nothing calls a model outside a test
 * until the slice that ingests, and this interface is where it plugs in.
 */
export function recorded(answers: Readonly<Record<string, string>>): Inference {
  return {
    ask(name: string): Promise<string> {
      const answer = answers[name];
      if (answer === undefined) {
        throw new Error(`no recorded answer for prompt "${name}"`);
      }
      return Promise.resolve(answer);
    },
  };
}
