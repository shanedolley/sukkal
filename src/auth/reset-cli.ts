/**
 * The way back into a box whose password is lost, from that box's own shell.
 *
 * ADR-0009 named this and left it unbuilt: a fresh installation has no mail
 * relay, so a reset link has nowhere to go. ADR-0023 then made it load
 * bearing rather than convenient, because the application is the only gate and
 * no second one can let anybody in.
 *
 * `scripts/reset-password.sh` is what a person runs. It prompts, hides what
 * they type, and pipes it here, so the password never reaches `ps` or a shell
 * history. This file holds the part that needs the database and the hash.
 *
 * THREE WAYS OUT, AND THE FIRST NEEDS NO BROWSER.
 *
 *   1. The default sets the password. It reads one line on stdin, holds it to
 *      the same four rules the setup wizard states, and ends every session.
 *   2. `--link` mints a reset token and prints the address that spends it.
 *      That is how `/reset` is reachable on a box with no mail, and it is the
 *      same token the mail would have carried.
 *   3. `--unlock` ends a run of failed sign-ins, which is the recovery path
 *      KPA-78 asks for. Nobody is locked out, because the run buys a wait and
 *      never a lock, so this shortens a wait rather than opening a door.
 *
 * BEING AT THIS SHELL IS THE PROOF. Somebody who can run this can already read
 * the database and the key that opens every stored credential, so asking them
 * for the address on the account would prove nothing and stop nobody.
 */
import { createInterface } from 'node:readline';

import { check, passes } from '../../apps/web/lib/password.ts';
import { connect } from '../db/connect.ts';
import { cleared, standing } from './attempts.ts';
import { issueFor, LIFETIME_MINUTES, OWNER, setPassword } from './reset.ts';

/** Where the link points when nobody says otherwise. */
const DEFAULT_URL = 'http://localhost:3000';

/** What the arguments came to. */
interface Asked {
  link: boolean;
  unlock: boolean;
  url: string;
}

function read(argv: string[]): Asked {
  const asked: Asked = { link: false, unlock: false, url: DEFAULT_URL };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === '--link') asked.link = true;
    else if (arg === '--unlock') asked.unlock = true;
    else if (arg === '--url') {
      const value = argv[at + 1];
      if (value === undefined) throw new Error('--url needs an address after it.');
      asked.url = value.replace(/\/+$/, '');
      at += 1;
    } else throw new Error(`I do not know the option ${String(arg)}.`);
  }
  return asked;
}

/** One line on stdin, with no prompt. The shell script does the asking. */
async function line(): Promise<string> {
  const reader = createInterface({ input: process.stdin });
  try {
    for await (const one of reader) return one;
    return '';
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  const asked = read(process.argv.slice(2));
  const client = connect('DATABASE_URL');
  await client.connect();

  try {
    // A box nobody has set up has no password to reset, and the wizard is
    // what writes the first one. Saying so beats failing on a null column.
    const account = await client.query<{ email: string | null }>(
      'SELECT email FROM users WHERE id = $1',
      [OWNER],
    );
    if (account.rows[0]?.email == null) {
      console.error(
        'No account on this installation yet. Open /setup in a browser instead.',
      );
      process.exitCode = 1;
      return;
    }

    if (asked.unlock) {
      const run = await standing(client, new Date());
      await cleared(client);
      console.log(
        run.failures === 0
          ? 'No run of failed sign-ins to end. The door was already answering at once.'
          : `Ended a run of ${String(run.failures)} failed sign-ins. The next attempt waits nothing, ` +
            `rather than ${String(run.waitSeconds)}s.`,
      );
      return;
    }

    if (asked.link) {
      const issued = await issueFor(client, OWNER, new Date());
      console.log(`${asked.url}/reset?token=${issued.token}`);
      console.log(
        `It lasts ${String(LIFETIME_MINUTES)} minutes, works once, and replaced ` +
          'any link asked for before it.',
      );
      return;
    }

    const password = await line();
    if (!passes(password)) {
      // The rules come from the same module the wizard draws its list from, so
      // the shell and the screen cannot state different ones.
      const missing = check(password)
        .filter((rule) => !rule.met)
        .map((rule) => rule.text.toLowerCase())
        .join(', ');
      console.error(`That password misses a rule. It needs ${missing}.`);
      process.exitCode = 1;
      return;
    }

    const ended = await setPassword(client, OWNER, password);
    console.log(
      `Password set. ${String(ended)} open ${ended === 1 ? 'session' : 'sessions'} ended, ` +
        'so every browser has to sign in again.',
    );
  } finally {
    await client.end();
  }
}

await main();
