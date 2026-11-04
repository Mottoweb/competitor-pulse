import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';

// Every setting is required. There are no defaults, so a missing value stops
// startup instead of quietly connecting somewhere unintended.
const databaseEnvSchema = z.object({
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
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
