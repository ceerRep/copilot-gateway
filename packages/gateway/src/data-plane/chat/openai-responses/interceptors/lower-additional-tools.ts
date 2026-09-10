import type { OpenAIResponsesInterceptor } from './types.ts';
import { providerModelOf } from '@floway-dev/provider';
import { lowerOpenAIResponsesAdditionalTools } from '@floway-dev/translate';

// Translated targets cannot express Responses' position-scoped tool
// declarations, so their compatibility floor promotes one item and rejects a
// second rather than silently erasing its ordering semantics. Native Responses
// preserves every item by default. The opt-in merge mode promotes every item
// for upstreams that cannot consume the input-item shape at all.
// https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input
export const withAdditionalToolsLowered: OpenAIResponsesInterceptor = async (ctx, _gatewayCtx, run) => {
  const enabled = providerModelOf(ctx.candidate).enabledFlags.has('openai-responses-additional-tools-shim');
  if (enabled) {
    ctx.payload = lowerOpenAIResponsesAdditionalTools(ctx.payload, 'all');
    return await run();
  }
  if (ctx.targetApi === 'openaiResponses') return await run();

  ctx.payload = lowerOpenAIResponsesAdditionalTools(ctx.payload, 'first');
  return await run();
};
