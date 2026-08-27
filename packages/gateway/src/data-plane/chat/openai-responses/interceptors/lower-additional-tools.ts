import type { OpenAIResponsesInterceptor } from './types.ts';
import { providerModelOf } from '@floway-dev/provider';
import { lowerOpenAIResponsesAdditionalTools } from '@floway-dev/translate';

// Translated targets cannot express Responses Lite's input-item declaration.
// Native Responses keeps it unless the operator opts into the same lowering.
// https://github.com/openai/codex/blob/44918ea10c0f99151c6710411b4322c2f5c96bea/codex-rs/core/src/client.rs#L847-L864
export const withAdditionalToolsLowered: OpenAIResponsesInterceptor = async (ctx, _gatewayCtx, run) => {
  const structurallyRequired = ctx.targetApi !== 'openaiResponses';
  const enabled = providerModelOf(ctx.candidate).enabledFlags.has('openai-responses-additional-tools-shim');
  if (!structurallyRequired && !enabled) return await run();

  ctx.payload = lowerOpenAIResponsesAdditionalTools(ctx.payload);
  return await run();
};
