import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, parseDatabaseConfig } from './config';

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  POSTGRES_HOST: 'db',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'd',
};

describe('parseDatabaseConfig', () => {
  it('falls back to the local compose defaults', () => {
    expect(parseDatabaseConfig({ NODE_ENV: 'test' })).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'competitor_pulse',
      password: 'competitor_pulse',
      database: 'competitor_pulse',
      logQueries: false,
    });
  });

  it('reads every setting from the environment', () => {
    expect(
      parseDatabaseConfig({
        NODE_ENV: 'test',
        POSTGRES_HOST: 'db',
        POSTGRES_PORT: '6543',
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_DB: 'd',
      }),
    ).toEqual({
      host: 'db',
      port: 6543,
      username: 'u',
      password: 'p',
      database: 'd',
      logQueries: false,
    });
  });

  it.each(['not-a-number', '0', '70000', '54.5'])(
    'rejects POSTGRES_PORT=%s',
    (port) => {
      expect(() => parseDatabaseConfig({ POSTGRES_PORT: port })).toThrow(
        /POSTGRES_PORT/,
      );
    },
  );

  it.each([
    ['development', true],
    [undefined, true],
    ['test', false],
  ])('with NODE_ENV=%s query logging is %s', (nodeEnv, logQueries) => {
    expect(parseDatabaseConfig({ NODE_ENV: nodeEnv }).logQueries).toBe(
      logQueries,
    );
  });

  describe('with NODE_ENV=production', () => {
    it('accepts a complete configuration, with query logging off', () => {
      expect(parseDatabaseConfig(PRODUCTION_ENV)).toEqual({
        host: 'db',
        port: 5432,
        username: 'u',
        password: 'p',
        database: 'd',
        logQueries: false,
      });
    });

    it.each([
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
    ])('refuses to fall back to a default for %s', (name) => {
      const env: NodeJS.ProcessEnv = { ...PRODUCTION_ENV };
      delete env[name];

      expect(() => parseDatabaseConfig(env)).toThrow(name);
    });

    it('does not put secret values in the error', () => {
      const env: NodeJS.ProcessEnv = {
        ...PRODUCTION_ENV,
        POSTGRES_PASSWORD: 'top-secret',
      };
      delete env.POSTGRES_HOST;

      expect(() => parseDatabaseConfig(env)).not.toThrow(/top-secret/);
    });
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
