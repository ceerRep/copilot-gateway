import { TranslatorInputError } from '../../translator-input-error.ts';
import type { CanonicalOpenAIResponsesPayload } from '@floway-dev/protocols/openai-responses';

// Responses Lite rebuilds this prompt-only declaration at input[0] on every
// request. Targets without the item shape consume the same tools at their
// native top-level slot; Codex does not carry old declarations in its history.
// https://github.com/openai/codex/blob/44918ea10c0f99151c6710411b4322c2f5c96bea/codex-rs/core/src/client.rs#L847-L864
export const lowerOpenAIResponsesAdditionalTools = (
  payload: CanonicalOpenAIResponsesPayload,
): CanonicalOpenAIResponsesPayload => {
  const indices = payload.input.flatMap((item, index) => item.type === 'additional_tools' ? [index] : []);
  if (indices.length === 0) return payload;
  if (indices.length !== 1 || indices[0] !== 0) {
    throw new TranslatorInputError('OpenAI Responses additional_tools must be the sole declaration at input[0].');
  }

  const [additionalTools, ...input] = payload.input;
  if (additionalTools.type !== 'additional_tools' || additionalTools.role !== 'developer') {
    throw new TranslatorInputError('OpenAI Responses additional_tools must use the developer role.');
  }
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    throw new TranslatorInputError('OpenAI Responses additional_tools cannot be combined with non-empty top-level tools.');
  }

  return {
    ...payload,
    input,
    tools: additionalTools.tools,
  };
};
