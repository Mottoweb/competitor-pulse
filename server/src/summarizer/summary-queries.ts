import type { DataSource } from 'typeorm';
import type { Listing } from '../source/listing';

export interface ClaimPendingSummariesInput {
  limit: number;
  retryAfterSeconds: number;
  maxAttempts: number;
}

export interface ClaimedSummary {
  snapshotId: string;
  competitorId: string;
  /** 1 for the first try. Selects the provider and fences late failure reports. */
  attempt: number;
  current: Listing;
  previous: Listing;
}

export interface CompleteSummaryInput {
  snapshotId: string;
  summary: string;
  provider: string;
  model: string;
}

export interface ScheduleSummaryRetryInput {
  snapshotId: string;
  attempt: number;
  error: string;
  retryAfterSeconds: number;
}

export interface FailSummaryInput {
  snapshotId: string;
  attempt: number;
  error: string;
}

// Stubs.
export class SummaryQueries {
  constructor(private readonly dataSource: DataSource) {}

  claimPendingSummaries(
    input: ClaimPendingSummariesInput,
  ): Promise<ClaimedSummary[]> {
    void this.dataSource;
    void input;
    return Promise.resolve([]);
  }

  completeSummary(input: CompleteSummaryInput): Promise<boolean> {
    void input;
    return Promise.resolve(false);
  }

  scheduleSummaryRetry(input: ScheduleSummaryRetryInput): Promise<boolean> {
    void input;
    return Promise.resolve(false);
  }

  failSummary(input: FailSummaryInput): Promise<boolean> {
    void input;
    return Promise.resolve(false);
  }
}
