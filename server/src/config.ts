import { z } from 'zod';

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
