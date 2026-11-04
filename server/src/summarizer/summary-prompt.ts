import type { LlmPrompt } from '../llm/llm-client';
import type { Listing } from '../source/listing';

export const MAX_FIELD_LENGTH = 2000;

export function buildSummaryPrompt(
  _previous: Listing,
  _current: Listing,
): LlmPrompt {
  return { system: '', user: '' };
}
