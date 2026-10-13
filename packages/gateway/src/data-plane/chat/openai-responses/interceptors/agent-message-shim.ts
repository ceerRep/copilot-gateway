import type { OpenAIResponsesInterceptor } from './types.ts';
import { agentMessageContent } from '../items/agent-message-content.ts';
import { externalFunctionOutputContent } from '../items/external-function-output-content.ts';
import type { OpenAIResponsesInputItem } from '@floway-dev/protocols/openai-responses';
import { providerModelOf } from '@floway-dev/provider';

const isStandaloneFunctionOutput = (item: OpenAIResponsesInputItem): boolean =>
  item.type === 'function_call_output' && (item.call_id === undefined || item.call_id === null || item.call_id === '');

// Codex delivers sub-agent tasks and inter-agent messages as `agent_message`
// input items. Only a native OpenAI Responses upstream can understand the item,
// and some Responses-compatible upstreams drop or reject it, so a spawned
// sub-agent never sees its task. Lower each item to a user message whose
// content frames the payload as coming from another agent, keeping the
// user-role wire slot from granting user authority.
//
// The lowering is mandatory when the target protocol is not OpenAI Responses
// (the translators do not know the item) and opt-in through
// `openai-responses-agent-message-shim` on a native target, which otherwise
// receives the item untouched. Named standalone function outputs follow the
// same policy: they are external notifications without a model-issued call.
// https://github.com/openai/codex/blob/0a2eb4696c26ac33204bcd255721ab30220a4774/codex-rs/protocol/src/models.rs#L1036-L1046
export const withOpenAIResponsesAgentMessageShim: OpenAIResponsesInterceptor = (ctx, _gatewayCtx, run) => {
  if (ctx.targetApi === 'openaiResponses'
    && !providerModelOf(ctx.candidate).enabledFlags.has('openai-responses-agent-message-shim')) return run();
  if (!ctx.payload.input.some(item => item.type === 'agent_message'
    || isStandaloneFunctionOutput(item))) return run();

  const input: OpenAIResponsesInputItem[] = [];
  const pendingCalls = new Set<string>();
  const pendingNotifications: OpenAIResponsesInputItem[] = [];
  const flushNotifications = () => {
    input.push(...pendingNotifications);
    pendingNotifications.length = 0;
  };
  for (const [index, item] of ctx.payload.input.entries()) {
    if (item.type === 'function_call_output' && isStandaloneFunctionOutput(item)) {
      const notification: OpenAIResponsesInputItem = {
        type: 'message', role: 'user', content: externalFunctionOutputContent(item, `input[${index}]`),
      };
      // A notification can arrive between parallel tool results. Keep the
      // results contiguous, then deliver every queued notification in order.
      if (pendingCalls.size > 0) pendingNotifications.push(notification);
      else input.push(notification);
      continue;
    }
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      pendingCalls.add(item.call_id);
    } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      pendingCalls.delete(item.call_id ?? '');
    } else {
      flushNotifications();
      pendingCalls.clear();
    }
    input.push(item.type === 'agent_message'
      ? { type: 'message', role: 'user', content: agentMessageContent(item) }
      : item);
    if (pendingCalls.size === 0) flushNotifications();
  }
  flushNotifications();
  ctx.payload = { ...ctx.payload, input };
  return run();
};
