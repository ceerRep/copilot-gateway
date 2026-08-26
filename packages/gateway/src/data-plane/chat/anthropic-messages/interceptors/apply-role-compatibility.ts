import type { AnthropicMessagesPayloadInterceptor } from './types.ts';
import type { AnthropicMessagesMessage } from '@floway-dev/protocols/anthropic-messages';
import { providerModelOf } from '@floway-dev/provider';

// An inline system turn must sit between user input and either an assistant
// history turn or the assistant turn this request will generate. The public
// API schema admits the role even though its prose still describes only the
// legacy top-level system channel.
// https://platform.claude.com/docs/en/api/messages/create
const isExpressibleInlineSystem = (messages: readonly AnthropicMessagesMessage[], index: number): boolean =>
  messages[index - 1]?.role === 'user'
  && (index === messages.length - 1 || messages[index + 1]?.role === 'assistant');

export const withRoleCompatibilityApplied: AnthropicMessagesPayloadInterceptor = (ctx, _gatewayCtx, run) => {
  if (ctx.targetApi !== 'anthropicMessages') return run();
  const forceRewrite = providerModelOf(ctx.candidate).enabledFlags.has('rewrite-mid-conv-system-to-user');
  const messages = ctx.payload.messages.map((message, index, source) =>
    message.role === 'system' && (forceRewrite || !isExpressibleInlineSystem(source, index))
      ? { role: 'user' as const, content: message.content }
      : message);
  if (messages.some((message, index) => message !== ctx.payload.messages[index])) {
    ctx.payload = { ...ctx.payload, messages };
  }

  return run();
};
