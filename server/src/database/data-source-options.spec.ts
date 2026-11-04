import { buildDataSourceOptions } from './data-source-options';

describe('buildDataSourceOptions', () => {
  it('limits how long a new connection can wait', () => {
    const options = buildDataSourceOptions({
      host: 'localhost',
      port: 5432,
      username: 'user',
      password: 'password',
      database: 'database',
      logQueries: false,
    });

    expect(options.connectTimeoutMS).toBeGreaterThan(0);
  });
});
