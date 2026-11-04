import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  backoffSeconds,
  classifyFailure,
  type FailureKind,
} from '../llm/failure';
import { LLM_CLIENT, type LlmClient } from '../llm/llm-client';
import type { LlmProvider } from '../llm/llm-config';
import { ProviderFailover } from '../llm/provider-failover';
import { SUMMARIZER_CONFIG, type SummarizerConfig } from './summarizer-config';
import { buildSummaryPrompt } from './summary-prompt';
import { SummaryQueries, type ClaimedSummary } from './summary-queries';

const MAX_ERROR_LENGTH = 500;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class SummaryWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SummaryWorker.name);
  private current: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly queries: SummaryQueries,
    private readonly failover: ProviderFailover,
    @Inject(LLM_CLIENT) private readonly client: LlmClient,
    @Inject(SUMMARIZER_CONFIG) private readonly config: SummarizerConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.check();
    this.timer = setInterval(
      () => void this.check(),
      this.config.checkIntervalSeconds * 1000,
    );
  }

  /** Runs before the database closes, so calls in progress can save their results. */
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
      // Claiming only what can start at once keeps every claimed row's retry
      // time longer than its call.
      while (!this.stopping) {
        const claimed = await this.queries.claimPendingSummaries({
          limit: this.config.concurrency,
          retryAfterSeconds: this.config.claimRetrySeconds,
          maxAttempts: this.config.maxAttempts,
        });
        if (claimed.length === 0) {
          return;
        }
        await Promise.all(claimed.map((claim) => this.summarize(claim)));
      }
    } catch (error) {
      this.logger.error(`Summary check failed: ${messageOf(error)}`);
    }
  }

  /** A database failure here leaves the row to come back after its retry time. */
  private async summarize(claim: ClaimedSummary): Promise<void> {
    try {
      const provider = this.failover.select(claim.attempt);
      const summary = await this.callProvider(claim, provider);
      if (summary === null) {
        return;
      }
      const saved = await this.queries.completeSummary({
        snapshotId: claim.snapshotId,
        summary,
        provider: provider.name,
        model: provider.model,
      });
      if (!saved) {
        this.logger.log(`Summary ${claim.snapshotId} is no longer pending`);
      }
    } catch (error) {
      this.logger.error(
        `Saving summary ${claim.snapshotId} failed: ${messageOf(error)}`,
      );
    }
  }

  /** Returns null once a failed call has been recorded. */
  private async callProvider(
    claim: ClaimedSummary,
    provider: LlmProvider,
  ): Promise<string | null> {
    try {
      return await this.client.complete(
        provider,
        buildSummaryPrompt(claim.previous, claim.current),
      );
    } catch (error) {
      await this.recordFailure(claim, provider, error);
      return null;
    }
  }

  private async recordFailure(
    claim: ClaimedSummary,
    provider: LlmProvider,
    error: unknown,
  ): Promise<void> {
    const kind = classifyFailure(error);
    this.failover.recordFailure(provider, kind);
    const message = `${provider.name}: ${messageOf(error)}`.slice(
      0,
      MAX_ERROR_LENGTH,
    );
    const failure = `Summary ${claim.snapshotId} attempt ${claim.attempt} failed on ${message}`;
    if (kind === 'provider_unusable') {
      this.logger.error(failure);
    } else {
      this.logger.warn(failure);
    }

    const retryAfterSeconds = this.retryDelay(kind, claim.attempt);
    if (retryAfterSeconds === null || claim.attempt >= this.config.maxAttempts) {
      await this.queries.failSummary({
        snapshotId: claim.snapshotId,
        attempt: claim.attempt,
        error: message,
      });
      return;
    }
    await this.queries.scheduleSummaryRetry({
      snapshotId: claim.snapshotId,
      attempt: claim.attempt,
      error: message,
      retryAfterSeconds,
    });
  }

  /** Null means another try can't help, because the request itself is at fault. */
  private retryDelay(kind: FailureKind, attempt: number): number | null {
    switch (kind) {
      case 'transient':
        return backoffSeconds(
          attempt,
          this.config.backoffBaseSeconds,
          this.config.backoffMaxSeconds,
        );
      case 'provider_unusable':
        // Waiting won't fix a bad key, so the next provider can go straight away.
        return 0;
      case 'bad_request':
        return null;
    }
  }
}
