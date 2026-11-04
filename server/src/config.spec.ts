import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, parseDatabaseConfig } from './config';

const COMPLETE_ENV = {
  POSTGRES_HOST: 'db',
  POSTGRES_PORT: '6543',
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'd',
};

describe('parseDatabaseConfig', () => {
  it('reads every setting from the environment', () => {
    expect(parseDatabaseConfig({ ...COMPLETE_ENV, NODE_ENV: 'test' })).toEqual({
      host: 'db',
      port: 6543,
      username: 'u',
      password: 'p',
      database: 'd',
      logQueries: false,
    });
  });

  describe.each([undefined, 'development', 'test', 'production'])(
    'with NODE_ENV=%s',
    (nodeEnv) => {
      it.each(Object.keys(COMPLETE_ENV))(
        'refuses to start without %s, because there are no defaults',
        (name) => {
          const env: NodeJS.ProcessEnv = {
            ...COMPLETE_ENV,
            NODE_ENV: nodeEnv,
          };
          delete env[name];

          expect(() => parseDatabaseConfig(env)).toThrow(name);
        },
      );
    },
  );

  it('names every missing setting at once', () => {
    expect(() => parseDatabaseConfig({})).toThrow(
      'POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB',
    );
  });

  it.each(Object.keys(COMPLETE_ENV))('rejects an empty %s', (name) => {
    expect(() =>
      parseDatabaseConfig({ ...COMPLETE_ENV, [name]: '' }),
    ).toThrow(name);
  });

  it.each(['not-a-number', '0', '70000', '54.5'])(
    'rejects POSTGRES_PORT=%s',
    (port) => {
      expect(() =>
        parseDatabaseConfig({ ...COMPLETE_ENV, POSTGRES_PORT: port }),
      ).toThrow(/POSTGRES_PORT/);
    },
  );

  it('does not put secret values in the error', () => {
    const env: NodeJS.ProcessEnv = {
      ...COMPLETE_ENV,
      POSTGRES_PASSWORD: 'top-secret',
    };
    delete env.POSTGRES_HOST;

    expect(() => parseDatabaseConfig(env)).not.toThrow(/top-secret/);
  });

  it.each([
    ['development', true],
    [undefined, true],
    ['test', false],
    ['production', false],
  ])('with NODE_ENV=%s query logging is %s', (nodeEnv, logQueries) => {
    expect(
      parseDatabaseConfig({ ...COMPLETE_ENV, NODE_ENV: nodeEnv }).logQueries,
    ).toBe(logQueries);
  });
});

describe('loadEnvFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'env-file-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true });
  });

  it('adds the values from the file', () => {
    const path = join(directory, '.env');
    writeFileSync(path, 'POSTGRES_PORT=6543\n# a comment\nPOSTGRES_DB="d b"\n');
    const env: NodeJS.ProcessEnv = {};

    loadEnvFile(path, env);

    expect(env).toEqual({ POSTGRES_PORT: '6543', POSTGRES_DB: 'd b' });
  });

  it('lets a variable that is already set win over the file', () => {
    const path = join(directory, '.env');
    writeFileSync(path, 'POSTGRES_PORT=6543\n');
    const env: NodeJS.ProcessEnv = { POSTGRES_PORT: '1111' };

    loadEnvFile(path, env);

    expect(env.POSTGRES_PORT).toBe('1111');
  });

  it('does nothing when the file does not exist', () => {
    const env: NodeJS.ProcessEnv = {};

    expect(() => loadEnvFile(join(directory, 'missing'), env)).not.toThrow();
    expect(env).toEqual({});
  });
});
