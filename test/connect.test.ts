import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { connect } from '../src/db/connect.ts';

/** Sets `variable` for one call, then restores whatever was there. */
function withEnv<T>(variable: string, value: string | undefined, work: () => T): T {
  const before = process.env[variable];
  if (value === undefined) {
    delete process.env[variable];
  } else {
    process.env[variable] = value;
  }
  try {
    return work();
  } finally {
    if (before === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before;
    }
  }
}

const VARIABLE = 'DATABASE_URL_CONNECT_TEST';
const BASE = 'postgresql://someone:secret@10.0.0.1:5432/nowhere';

describe('connect', () => {
  test('names the variable it could not find', () => {
    withEnv(VARIABLE, undefined, () => {
      assert.throws(() => connect(VARIABLE), new RegExp(`${VARIABLE} is unset`));
    });
  });

  test('refuses a connection string that asks for no encryption', () => {
    for (const mode of ['disable', 'prefer', 'allow']) {
      withEnv(VARIABLE, `${BASE}?sslmode=${mode}`, () => {
        assert.throws(() => connect(VARIABLE), /must be encrypted/, `sslmode=${mode}`);
      });
    }
  });

  test('refuses a connection string that names no mode at all', () => {
    withEnv(VARIABLE, BASE, () => {
      assert.throws(() => connect(VARIABLE), /asks for sslmode=nothing/);
    });
  });

  test('translates require to the driver spelling, and leaves the rest alone', () => {
    for (const [given, expected] of [
      ['require', false],
      ['verify-full', true],
      ['no-verify', false],
    ] as const) {
      withEnv(VARIABLE, `${BASE}?sslmode=${given}`, () => {
        const client = connect(VARIABLE);
        // `require` and `no-verify` both encrypt without verifying the chain.
        assert.equal(
          (client as unknown as { connectionParameters: { ssl: { rejectUnauthorized?: boolean } } })
            .connectionParameters.ssl.rejectUnauthorized ?? true,
          expected,
          `sslmode=${given}`,
        );
      });
    }
  });

  test('reads the host, the user and the database from the environment', () => {
    withEnv(VARIABLE, `${BASE}?sslmode=require`, () => {
      const client = connect(VARIABLE);
      const parameters = (client as unknown as {
        connectionParameters: { host: string; user: string; database: string };
      }).connectionParameters;
      assert.equal(parameters.host, '10.0.0.1');
      assert.equal(parameters.user, 'someone');
      assert.equal(parameters.database, 'nowhere');
    });
  });
});
