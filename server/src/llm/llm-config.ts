import type { ProviderApi, ProviderName, TokenLimitParam } from './providers';

export interface LlmProvider {
  name: ProviderName;
  api: ProviderApi;
  apiKey: string;
  baseUrl: string;
  model: string;
  tokenLimitParam: TokenLimitParam;
}

export interface LlmConfig {
  providers: LlmProvider[];
  maxAttempts: number;
  timeoutMs: number;
  maxTokens: number;
  failureCooldownMs: number;
  unusableCooldownMs: number;
}

export const LLM_CONFIG = Symbol('LLM_CONFIG');

export function parseLlmConfig(_env: NodeJS.ProcessEnv): LlmConfig {
  return {
    providers: [],
    maxAttempts: 0,
    timeoutMs: 0,
    maxTokens: 0,
    failureCooldownMs: 0,
    unusableCooldownMs: 0,
  };
}
