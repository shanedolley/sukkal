import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import pg from 'pg';
import { connect, keepDatesAsText } from '../src/db/connect.ts';

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
const BASE = 'postgresql://someone:PLACEHOLDER@10.0.0.1:5432/nowhere';  // remote, so TLS is required

describe('connect', () => {
  test('names the variable it could not find', () => {
    withEnv(VARIABLE, undefined, () => {
      assert.throws(() => connect(VARIABLE), new RegExp(`^Error: ${VARIABLE} is unset`));
    });
  });

  test('refuses a connection string that asks for no encryption', () => {
    for (const mode of ['disable', 'prefer', 'allow']) {
      withEnv(VARIABLE, `${BASE}?sslmode=${mode}`, () => {
        assert.throws(() => connect(VARIABLE), /must be encrypted/, `sslmode=${mode}`);
      });
    }
  });

  test('lets a loopback host connect in the clear', () => {
    // amaterasu's Postgres also listens on 127.0.0.1, and CI uses a service
    // container. Neither connection reaches a network, so neither needs TLS.
    for (const host of ['localhost', '127.0.0.1']) {
      withEnv(VARIABLE, `postgresql://someone:PLACEHOLDER@${host}:5432/sukkal_dev`, () => {
        assert.doesNotThrow(() => connect(VARIABLE), `host ${host}`);
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

// ---------------------------------------------------------------------------
// The date rule. It takes the registry rather than reaching for one, because
// apps/web installs its own copy of the driver and a parser set on this one is
// absent from that one. A source dated 19 August read as the 18th from Sydney
// until the web tier called this with its own registry.
// ---------------------------------------------------------------------------

describe('keepDatesAsText', () => {
  test('registers a pass-through on whichever registry it is given', () => {
    const registered = new Map<number, (value: string) => string>();
    keepDatesAsText({
      builtins: pg.types.builtins,
      setTypeParser: (id: number, parse: (value: string) => string) => {
        registered.set(id, parse);
      },
    } as unknown as typeof pg.types);

    const parse = registered.get(pg.types.builtins.DATE);
    assert.ok(parse, 'no parser was registered for a date');
    assert.equal(parse('2026-08-19'), '2026-08-19');
  });

  test('the root package already has it, so a date is never a Date', () => {
    const parse = pg.types.getTypeParser(pg.types.builtins.DATE) as (
      value: string,
    ) => unknown;
    assert.equal(parse('2026-08-19'), '2026-08-19');
  });
});
