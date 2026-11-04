import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const REQUIRED_IN_PRODUCTION = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
] as const;

const databaseEnvSchema = z.object({
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1).default('competitor_pulse'),
  POSTGRES_PASSWORD: z.string().min(1).default('competitor_pulse'),
  POSTGRES_DB: z.string().min(1).default('competitor_pulse'),
  NODE_ENV: z.string().optional(),
});

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logQueries: boolean;
}

export function parseDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  if (env.NODE_ENV === 'production') {
    // The defaults are for local development. Production must not fall back to them.
    const missing = REQUIRED_IN_PRODUCTION.filter(
      (name) => env[name] === undefined,
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing database configuration in production: ${missing.join(', ')}`,
      );
    }
  }
  const result = databaseEnvSchema.safeParse(env);
  if (!result.success) {
    // Names the invalid settings without echoing their values, which may be secret.
    const invalid = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid database configuration: ${invalid.join(', ')}`);
  }
  const parsed = result.data;
  return {
    host: parsed.POSTGRES_HOST,
    port: parsed.POSTGRES_PORT,
    username: parsed.POSTGRES_USER,
    password: parsed.POSTGRES_PASSWORD,
    database: parsed.POSTGRES_DB,
    logQueries: parsed.NODE_ENV !== 'test' && parsed.NODE_ENV !== 'production',
  };
}

/**
 * Adds a .env file's values to env. A variable that is already set wins, so
 * real environment settings override the file. A missing file is fine, because
 * deployed environments set real variables instead.
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(path)) {
    return;
  }
  const values = parseEnv(readFileSync(path, 'utf8'));
  for (const [name, value] of Object.entries(values)) {
    env[name] ??= value;
  }
}
