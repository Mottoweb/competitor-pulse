export interface SummarizerConfig {
  checkIntervalSeconds: number;
  /** The most LLM calls running at once. */
  concurrency: number;
  /** Must stay longer than the LLM timeout, or a slow call gets claimed twice. */
  claimRetrySeconds: number;
  backoffBaseSeconds: number;
  backoffMaxSeconds: number;
  maxAttempts: number;
}

export const SUMMARIZER_CONFIG = Symbol('SUMMARIZER_CONFIG');

export function parseSummarizerConfig(
  _env: NodeJS.ProcessEnv,
  maxAttempts: number,
): SummarizerConfig {
  return {
    checkIntervalSeconds: 0,
    concurrency: 0,
    claimRetrySeconds: 0,
    backoffBaseSeconds: 0,
    backoffMaxSeconds: 0,
    maxAttempts,
  };
}
