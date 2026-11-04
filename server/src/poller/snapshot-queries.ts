import type { DataSource, EntityManager } from 'typeorm';
import type { Listing } from '../source/listing';
import type { Snapshot } from './snapshot.entity';

export interface ClaimDueCompetitorsInput {
  limit: number;
  intervalSeconds: number;
  /** 0.1 spreads the next poll over the interval plus or minus 10%. */
  jitterRatio: number;
}

export interface SaveSnapshotInput {
  competitorId: string;
  listing: Listing;
  fetchedAt: Date;
  /** Runs inside the save transaction, so its writes commit or roll back with the snapshot. */
  inTransaction?: (tx: EntityManager) => Promise<void>;
}

export interface SavedSnapshot {
  id: string;
  changed: boolean;
}

// Stubs.
export class SnapshotQueries {
  constructor(private readonly dataSource: DataSource) {}

  claimDueCompetitors(input: ClaimDueCompetitorsInput): Promise<string[]> {
    void this.dataSource;
    void input;
    return Promise.resolve([]);
  }

  saveSnapshot(input: SaveSnapshotInput): Promise<SavedSnapshot | null> {
    void input;
    return Promise.resolve(null);
  }

  listTimeline(competitorId: string, limit?: number): Promise<Snapshot[]> {
    void competitorId;
    void limit;
    return Promise.resolve([]);
  }
}
