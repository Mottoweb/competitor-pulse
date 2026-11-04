import type { ListingSource } from '../source/listing-source';
import type { PollerConfig } from './poller-config';
import type { SnapshotQueries } from './snapshot-queries';

export class PollWorker {
  constructor(
    private readonly queries: SnapshotQueries,
    private readonly source: ListingSource,
    private readonly config: PollerConfig,
  ) {}

  check(): Promise<void> {
    return Promise.resolve();
  }
}
