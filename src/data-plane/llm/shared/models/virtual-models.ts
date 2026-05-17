import { loadGatewayConfig } from "../../../../lib/gateway-config.ts";
import type { ChatCompletionsPayload } from "../../../../lib/chat-completions-types.ts";
import type { MessagesPayload } from "../../../../lib/messages-types.ts";
import type { ResponsesPayload } from "../../../../lib/responses-types.ts";

export interface VirtualModelResolution {
  targetModel: string;
}

export const resolveVirtualModel = async (
  model: string,
): Promise<VirtualModelResolution | null> => {
  if (model !== "codex-auto-review") return null;
  const config = await loadGatewayConfig();
  if (!config.codexAutoReviewModel) return null;
  return { targetModel: config.codexAutoReviewModel };
};

export const stripMessagesReasoning = (
  payload: MessagesPayload,
): MessagesPayload => {
  const { output_config: _outputConfig, ...rest } = payload;
  return { ...rest, thinking: { type: "disabled" as const } };
};

export const stripResponsesReasoning = (
  payload: ResponsesPayload,
): ResponsesPayload => {
  const { reasoning: _reasoning, ...rest } = payload;
  return rest;
};

export const stripChatCompletionsReasoning = (
  payload: ChatCompletionsPayload,
): ChatCompletionsPayload => {
  const { reasoning_effort: _reasoningEffort, ...rest } = payload;
  return rest;
};
