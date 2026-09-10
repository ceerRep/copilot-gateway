import { TranslatorInputError } from '../../translator-input-error.ts';
import type { CanonicalOpenAIResponsesPayload } from '@floway-dev/protocols/openai-responses';

// A translated target can represent the tools but not the declaration's
// position-scoped availability. `first` is the conservative compatibility
// floor: promote one declaration and reject a second. `all` is an explicit
// lossy mode that merges every declaration into the request-level tool set.
// https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input
export const lowerOpenAIResponsesAdditionalTools = (
  payload: CanonicalOpenAIResponsesPayload,
  mode: 'first' | 'all' = 'first',
): CanonicalOpenAIResponsesPayload => {
  const declarations = payload.input.filter(item => item.type === 'additional_tools');
  if (declarations.length === 0) return payload;
  if (mode === 'first' && declarations.length > 1) {
    throw new TranslatorInputError('Cannot translate more than one OpenAI Responses additional_tools item without the additional-tools merge shim.');
  }
  for (const declaration of declarations) {
    if (declaration.role !== 'developer') {
      throw new TranslatorInputError('OpenAI Responses additional_tools must use the developer role.');
    }
  }

  const lowered = mode === 'all' ? declarations : declarations.slice(0, 1);
  const loweredItems = new Set<CanonicalOpenAIResponsesPayload['input'][number]>(lowered);
  return {
    ...payload,
    input: payload.input.filter(item => !loweredItems.has(item)),
    tools: [...(payload.tools ?? []), ...lowered.flatMap(item => item.tools)],
  };
};
