import type { ChatCompletionsPayload } from "../../shared/protocol/chat-completions.ts";
import type { ModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import type { UpstreamFetchOptions } from "../../../../shared/upstream/types.ts";

export type ChatPlan =
  | { target: "messages"; fetchOptions: UpstreamFetchOptions }
  | { target: "responses"; fetchOptions: UpstreamFetchOptions }
  | { target: "chat-completions"; fetchOptions: UpstreamFetchOptions };

const hasVision = (payload: ChatCompletionsPayload): boolean =>
  payload.messages.some((message) =>
    Array.isArray(message.content) &&
    message.content.some((part) => part.type === "image_url")
  );

export const planChatRequest = (
  payload: ChatCompletionsPayload,
  capabilities: ModelCapabilities,
): ChatPlan | null => {
  const fetchOptions = { vision: hasVision(payload) };

  // Chat-origin routing intentionally prefers Messages when the model supports
  // it, because that path preserves more Anthropic structure than native Chat.
  if (capabilities.supportsMessages) {
    return {
      target: "messages",
      fetchOptions,
    };
  }

  if (capabilities.supportsChatCompletions) {
    return {
      target: "chat-completions",
      fetchOptions,
    };
  }

  if (capabilities.supportsResponses) {
    return {
      target: "responses",
      fetchOptions,
    };
  }

  // Legacy model-name fallback only for upstreams without explicit capability
  // metadata (Copilot models whose /models entry omits supported_endpoints).
  // Custom upstreams declare capabilities explicitly — routing to an endpoint
  // the admin didn't configure would violate that intent.
  if (capabilities.hasExplicitCapabilities) return null;

  // Capability misses keep the legacy model-name heuristic so old callers still
  // get the same Claude -> Messages and non-Claude -> Chat routing behavior.
  return payload.model.startsWith("claude")
    ? {
      target: "messages",
      fetchOptions,
    }
    : {
      target: "chat-completions",
      fetchOptions,
    };
};
