export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logQueries: boolean;
}

// Stub: returns the local defaults and ignores the environment.
export function parseDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  void env;
  return {
    host: 'localhost',
    port: 5432,
    username: 'competitor_pulse',
    password: 'competitor_pulse',
    database: 'competitor_pulse',
    logQueries: false,
  };
}
