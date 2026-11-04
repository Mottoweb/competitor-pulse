import { parseDatabaseConfig } from './config';

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
    ['production', false],
  ])('with NODE_ENV=%s query logging is %s', (nodeEnv, logQueries) => {
    expect(parseDatabaseConfig({ NODE_ENV: nodeEnv }).logQueries).toBe(
      logQueries,
    );
  });
});
