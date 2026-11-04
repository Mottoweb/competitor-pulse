export type FailureKind = 'transient' | 'provider_unusable' | 'bad_request';

export class EmptyResponseError extends Error {
  constructor(provider: string) {
    super(`${provider} returned an empty response`);
  }
}

export function classifyFailure(_error: unknown): FailureKind {
  return 'bad_request';
}

export function backoffSeconds(
  _attempt: number,
  _baseSeconds: number,
  _maxSeconds: number,
): number {
  return 0;
}
