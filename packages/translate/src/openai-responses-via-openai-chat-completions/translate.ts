import { translateToSourceEvents } from './events.ts';
import { buildTargetRequest } from './request.ts';
import type { TranslateTrip } from '../types.ts';
import type { OpenAIChatCompletionsStreamEvent, OpenAIChatCompletionsPayload } from '@floway-dev/protocols/openai-chat-completions';
import type { OpenAIResponsesRequestPayload, OpenAIResponsesStreamEvent } from '@floway-dev/protocols/openai-responses';

export const translateOpenAIResponsesViaOpenAIChatCompletions: TranslateTrip<
  OpenAIResponsesRequestPayload, OpenAIResponsesStreamEvent, OpenAIChatCompletionsPayload, OpenAIChatCompletionsStreamEvent
> = async src => {
  // Tool mappings are produced while lowering the request and reused while
  // raising events, preserving wrapped custom tools and namespace functions.
  const { target, customToolNames, namespaceToolNames } = buildTargetRequest(src);

  return {
    target,
    events: frames => translateToSourceEvents(frames, customToolNames, namespaceToolNames.targetToSource),
  };
};
