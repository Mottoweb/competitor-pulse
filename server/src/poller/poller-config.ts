export interface PollerConfig {
  pollIntervalSeconds: number;
  checkIntervalSeconds: number;
  /** 0.1 spreads the next poll over the interval plus or minus 10%. */
  jitterRatio: number;
  /** The most polls running at once. */
  concurrency: number;
  /** The wait before each retry of a failed snapshot write. */
  saveRetryDelaysMs: number[];
}

export const POLLER_CONFIG = Symbol('POLLER_CONFIG');

export function parsePollerConfig(_env: NodeJS.ProcessEnv): PollerConfig {
  return {
    pollIntervalSeconds: 0,
    checkIntervalSeconds: 0,
    jitterRatio: 0,
    concurrency: 0,
    saveRetryDelaysMs: [],
  };
}
