import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  LISTING_SOURCE,
  type FetchedListing,
  type ListingSource,
} from '../source/listing-source';
import { POLLER_CONFIG, type PollerConfig } from './poller-config';
import { SnapshotQueries } from './snapshot-queries';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class PollWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(PollWorker.name);
  private current: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly queries: SnapshotQueries,
    @Inject(LISTING_SOURCE) private readonly source: ListingSource,
    @Inject(POLLER_CONFIG) private readonly config: PollerConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.check();
    this.timer = setInterval(
      () => void this.check(),
      this.config.checkIntervalSeconds * 1000,
    );
  }

  /** Runs before the database closes, so a check in progress can finish its saves. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
    await this.current;
  }

  /** Never rejects. A check already running on this instance is joined, not repeated. */
  check(): Promise<void> {
    this.current ??= this.drain().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async drain(): Promise<void> {
    try {
      // Sequential on purpose: each batch waits for the last, which caps concurrency.
      while (!this.stopping) {
        const ids = await this.queries.claimDueCompetitors({
          limit: this.config.concurrency,
          intervalSeconds: this.config.pollIntervalSeconds,
          jitterRatio: this.config.jitterRatio,
        });
        if (ids.length === 0) {
          return;
        }
        await Promise.all(ids.map((id) => this.poll(id)));
      }
    } catch (error) {
      this.logger.error(`Poll check failed: ${messageOf(error)}`);
    }
  }

  /** A failure writes nothing. The competitor is polled again when next due. */
  private async poll(competitorId: string): Promise<void> {
    try {
      const fetched = await this.source.fetchListing(competitorId);
      await this.saveWithRetry(competitorId, fetched, new Date());
    } catch (error) {
      this.logger.error(`Poll of ${competitorId} failed: ${messageOf(error)}`);
    }
  }

  /** Reuses the listing already fetched, so a retry doesn't fetch it again. */
  private async saveWithRetry(
    competitorId: string,
    fetched: FetchedListing,
    fetchedAt: Date,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const saved = await this.queries.saveSnapshot({
          competitorId,
          listing: fetched.listing,
          fetchedAt,
          inTransaction: (tx) => fetched.markSaved(tx),
        });
        if (saved === null) {
          this.logger.log(`${competitorId} was deleted during its poll`);
        }
        return;
      } catch (error) {
        const delayMs = this.config.saveRetryDelaysMs[attempt];
        if (delayMs === undefined) {
          throw error;
        }
        this.logger.warn(
          `Save for ${competitorId} failed, retrying: ${messageOf(error)}`,
        );
        await sleep(delayMs);
      }
    }
  }
}
