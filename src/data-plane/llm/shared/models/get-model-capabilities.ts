import { findModel, type ModelInfo } from "../../../../lib/models-cache.ts";
import type { Upstream } from "../../../../lib/upstream/types.ts";

interface ModelCapabilitiesModel {
  id: string;
  supported_endpoints?: string[];
  capabilities?: {
    type?: string;
    limits?: {
      max_output_tokens?: number;
    };
    supports?: {
      adaptive_thinking?: boolean;
    };
  };
}

export interface ModelCapabilities {
  model?: ModelCapabilitiesModel;
  maxOutputTokens?: number;
  supportsMessages: boolean;
  supportsResponses: boolean;
  supportsChatCompletions: boolean;
  supportsAdaptiveThinking: boolean;
}

// Copilot's /models response only annotates supported_endpoints on newer
// entries (Claude family, GPT-5/Codex family, Gemini 3 preview). Legacy chat
// models (gpt-4o, gpt-4.1, gpt-4o-mini, gemini-2.5-pro, …) omit the field
// entirely. Treating the omission as "no endpoints supported" makes every
// source's plan() return null and surfaces the gateway-internal "Model X does
// not support the /<endpoint> endpoint." error. Copilot has always served
// those legacy chat models from /chat/completions, so when the array is
// missing we infer chat support from capabilities.type === "chat" and leave
// the explicit-array path strict so an upstream-declared empty list is still
// honored.
const inferredChatCompletionsSupport = (
  model: ModelInfo | undefined,
): boolean =>
  model !== undefined &&
  model.supported_endpoints === undefined &&
  model.capabilities?.type === "chat";

// When the upstream's /models entry does not declare per-model
// `supported_endpoints` (most third-party OpenAI-compatible providers do
// not), fall back to the upstream-level configuration so each model on that
// upstream inherits the admin's declared capability set.
//
// Copilot's /models is authoritative — its embedding/non-chat SKUs report
// per-model supported_endpoints explicitly, so a missing field on a Copilot
// entry means "not declared" rather than "all of the above". Skip the
// upstream-level fallback for copilot upstreams to avoid promoting
// embedding-only models into the chat/responses/messages routing surface.
export const getModelCapabilities = async (
  modelId: string,
  upstream: Upstream,
): Promise<ModelCapabilities> => {
  const model = await findModel(modelId, upstream);
  const supportedEndpoints = model?.supported_endpoints ??
    (upstream.kind === "openai" ? upstream.supportedEndpoints : []);

  return {
    model,
    maxOutputTokens: model?.capabilities?.limits?.max_output_tokens,
    supportsMessages: supportedEndpoints.includes("/v1/messages"),
    supportsResponses: supportedEndpoints.includes("/responses"),
    supportsChatCompletions: supportedEndpoints.includes("/chat/completions") ||
      inferredChatCompletionsSupport(model),
    supportsAdaptiveThinking:
      model?.capabilities?.supports?.adaptive_thinking === true,
  };
};
