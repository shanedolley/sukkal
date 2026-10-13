import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_EMAIL, chooseCredentials, KEYCHAIN_ITEM } from '../scripts/decision-credentials.ts';

const SECRET = 'keychain-secret-value';
const never = (): string | null => assert.fail('the Keychain must not be read');

test('a token in the environment is used as given and the Keychain is not read', () => {
  const got = chooseCredentials(
    {
      KOINON_JIRA_SITE: 'https://example.atlassian.net',
      KOINON_JIRA_EMAIL: 'shane@koinon.com.au',
      KOINON_JIRA_TOKEN: 'env-token',
    },
    never,
  );
  assert.deepEqual(got, {
    site: 'https://example.atlassian.net',
    email: 'shane@koinon.com.au',
    token: 'env-token',
  });
});

test('a token in the environment without an email throws', () => {
  assert.throws(() => chooseCredentials({ KOINON_JIRA_TOKEN: 't' }, never), /KOINON_JIRA_EMAIL/);
});

test('with no environment token the Keychain token pairs with the agent email, not KOINON_JIRA_EMAIL', () => {
  const asked: string[] = [];
  const got = chooseCredentials({ KOINON_JIRA_EMAIL: 'shane@koinon.com.au' }, (item) => {
    asked.push(item);
    return SECRET;
  });
  assert.deepEqual(asked, [KEYCHAIN_ITEM]);
  assert.equal(got.email, AGENT_EMAIL);
  assert.equal(got.token, SECRET);
});

test('an empty environment token falls through to the Keychain', () => {
  assert.equal(chooseCredentials({ KOINON_JIRA_TOKEN: '' }, () => SECRET).token, SECRET);
});

test('the site defaults to the Koinon site', () => {
  assert.equal(chooseCredentials({}, () => SECRET).site, 'https://koinon.atlassian.net');
});

test('with neither source it throws naming both, and the message holds no token', () => {
  assert.throws(
    () => chooseCredentials({}, () => null),
    (error: Error) =>
      error.message.includes('KOINON_JIRA_TOKEN') &&
      error.message.includes(KEYCHAIN_ITEM) &&
      !error.message.includes(SECRET),
  );
});
