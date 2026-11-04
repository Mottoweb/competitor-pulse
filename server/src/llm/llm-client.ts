import type { LlmConfig, LlmProvider } from './llm-config';

export interface LlmPrompt {
  system: string;
  user: string;
}

export interface LlmClient {
  complete(provider: LlmProvider, prompt: LlmPrompt): Promise<string>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export class SdkLlmClient implements LlmClient {
  constructor(private readonly config: LlmConfig) {}

  complete(_provider: LlmProvider, _prompt: LlmPrompt): Promise<string> {
    return Promise.resolve(String(this.config.maxTokens));
  }
}
