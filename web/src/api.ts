import {
  SUMMARY_STATUSES,
  type Competitor,
  type Snapshot,
} from '@competitor-pulse/shared';
import { z } from 'zod';

const competitorListSchema: z.ZodType<Competitor[]> = z.array(
  z.object({ id: z.string() }),
);
const snapshotListSchema: z.ZodType<Snapshot[]> = z.array(
  z.object({
    fetchedAt: z.string(),
    title: z.string(),
    tagline: z.string(),
    price: z.string(),
    description: z.string(),
    changed: z.boolean(),
    summary: z.string().nullable(),
    summaryStatus: z.enum(SUMMARY_STATUSES),
    summaryProvider: z.string().nullable(),
    summaryModel: z.string().nullable(),
  }),
);
const errorBodySchema = z.object({ message: z.string() });

export type { Competitor, Snapshot };

/** A failed API call. Its message is written to be shown to the user. */
export class ApiError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Could not reach the server');
  }
  if (!response.ok) {
    const body = errorBodySchema.safeParse(await readJson(response));
    throw new ApiError(
      body.success ? body.data.message : `Request failed (${response.status})`,
    );
  }
  return response;
}

async function getParsed<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJson(await send(path)));
  if (!parsed.success) {
    throw new ApiError('Unexpected response from the server');
  }
  return parsed.data;
}

function competitorPath(id: string): string {
  return `/api/competitors/${encodeURIComponent(id)}`;
}

export function listCompetitors(): Promise<Competitor[]> {
  return getParsed('/api/competitors', competitorListSchema);
}

export async function addCompetitor(id: string): Promise<void> {
  await send('/api/competitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function removeCompetitor(id: string): Promise<void> {
  await send(competitorPath(id), { method: 'DELETE' });
}

export function listSnapshots(id: string, limit: number): Promise<Snapshot[]> {
  return getParsed(
    `${competitorPath(id)}/snapshots?limit=${limit}`,
    snapshotListSchema,
  );
}
