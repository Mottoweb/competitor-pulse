import type { LlmClient } from '../llm/llm-client';
import type { ProviderFailover } from '../llm/provider-failover';
import type { SummarizerConfig } from './summarizer-config';
import type { SummaryQueries } from './summary-queries';

export class SummaryWorker {
  constructor(
    readonly queries: SummaryQueries,
    readonly failover: ProviderFailover,
    readonly client: LlmClient,
    readonly config: SummarizerConfig,
  ) {}

  check(): Promise<void> {
    return Promise.resolve();
  }
}
