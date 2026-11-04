import type { FailureKind } from './failure';
import type { LlmConfig, LlmProvider } from './llm-config';

export class ProviderFailover {
  constructor(
    private readonly config: LlmConfig,
    private readonly now: () => number = Date.now,
  ) {}

  select(_attempt: number): LlmProvider {
    const provider = this.config.providers[0];
    if (provider === undefined) {
      throw new Error('No LLM provider is configured');
    }
    return provider;
  }

  recordFailure(_provider: LlmProvider, _kind: FailureKind): void {
    this.now();
  }
}
