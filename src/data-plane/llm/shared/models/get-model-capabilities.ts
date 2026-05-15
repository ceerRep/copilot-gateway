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
  // True when supported_endpoints came from an authoritative source (per-model
  // metadata or admin-configured upstream-level config). When false, the
  // caller's planning layer may fall back to legacy model-name heuristics.
  hasExplicitCapabilities: boolean;
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

// Resolve the effective supported_endpoints for a model on a given upstream.
//
// Custom OpenAI-compatible upstreams have admin-configured capabilities that
// are trusted and tight — when the provider's /models entry omits per-model
// supported_endpoints, the upstream-level config fills in.
//
// Copilot's /models is authoritative per SKU; a missing field means "not
// declared", not "all of the above". We return an empty list so embedding-only
// SKUs are not promoted into the chat/responses/messages routing surface.
// The caller's planning layer is still allowed to layer on legacy model-name
// heuristics (see `inferredChatCompletionsSupport`) when the field is missing.
export const resolveEffectiveSupportedEndpoints = (
  modelEndpoints: string[] | undefined,
  upstream: { kind: Upstream["kind"]; supportedEndpoints: string[] },
): { endpoints: string[]; explicit: boolean } => {
  if (modelEndpoints) return { endpoints: modelEndpoints, explicit: true };
  if (upstream.kind === "openai") {
    return { endpoints: upstream.supportedEndpoints, explicit: true };
  }
  return { endpoints: [], explicit: false };
};

export const getModelCapabilities = async (
  modelId: string,
  upstream: Upstream,
): Promise<ModelCapabilities> => {
  const model = await findModel(modelId, upstream);
  return modelCapabilitiesFromModel(model, upstream);
};

export const modelCapabilitiesFromModel = (
  model: ModelInfo | undefined,
  upstream: { kind: Upstream["kind"]; supportedEndpoints: string[] },
): ModelCapabilities => {
  const { endpoints: supportedEndpoints, explicit } =
    resolveEffectiveSupportedEndpoints(model?.supported_endpoints, upstream);

  return {
    model,
    maxOutputTokens: model?.capabilities?.limits?.max_output_tokens,
    supportsMessages: supportedEndpoints.includes("/v1/messages"),
    supportsResponses: supportedEndpoints.includes("/responses"),
    supportsChatCompletions: supportedEndpoints.includes("/chat/completions") ||
      inferredChatCompletionsSupport(model),
    supportsAdaptiveThinking:
      model?.capabilities?.supports?.adaptive_thinking === true,
    hasExplicitCapabilities: explicit,
  };
};
