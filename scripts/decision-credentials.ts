/**
 * Which Jira credentials `decision-register.ts` signs in with.
 *
 * The token lives in the macOS Keychain item `kothar-jira-agent`, which belongs
 * to the Claude Agent account. `KOINON_JIRA_EMAIL` still names Shane, so a
 * token read from the Keychain is never paired with it: the token and the email
 * always name one account. Kept apart from the script so a test can import it
 * without running a search.
 */
import { execFileSync } from 'node:child_process';

export const KEYCHAIN_ITEM = 'kothar-jira-agent';
export const AGENT_EMAIL = 'claude@koinon.com.au';
const DEFAULT_SITE = 'https://koinon.atlassian.net';

export interface Credentials {
  site: string;
  email: string;
  token: string;
}

/** The password of a Keychain item, or null when there is none to read. */
export function readKeychain(item: string): string | null {
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', item, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
    }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/** Pick the credentials from the environment, else the Keychain. No message here holds a token. */
export function chooseCredentials(
  env: Record<string, string | undefined>,
  read: (item: string) => string | null = readKeychain,
): Credentials {
  const site = env['KOINON_JIRA_SITE'] || DEFAULT_SITE;
  const envToken = env['KOINON_JIRA_TOKEN'];

  if (envToken) {
    const email = env['KOINON_JIRA_EMAIL'];
    if (!email) throw new Error('KOINON_JIRA_EMAIL must be set with KOINON_JIRA_TOKEN.');
    return { site, email, token: envToken };
  }

  const token = read(KEYCHAIN_ITEM);
  if (token) return { site, email: AGENT_EMAIL, token };

  throw new Error(
    `No Jira token. Set KOINON_JIRA_TOKEN, or add the macOS Keychain item ${KEYCHAIN_ITEM}. ` +
      'See docs/runbooks/secrets.md.',
  );
}
