export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  object: string;
  capabilities: {
    family: string;
    type: string;
    limits: {
      max_context_window_tokens?: number;
      max_non_streaming_output_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
    supports: {
      tool_calls?: boolean;
      parallel_tool_calls?: boolean;
      streaming?: boolean;
      vision?: boolean;
      adaptive_thinking?: boolean;
      reasoning_effort?: string[];
    };
  };
  supported_endpoints?: string[];
  // Set by the merging /v1/models handler so clients can group models by the
  // upstream kind that owns them. Not present on raw upstream /models payloads.
  upstream_kind?: "copilot" | "openai";
  // Set by the gateway after endpoint resolution so consumers can filter
  // generation-capable models without duplicating endpoint rules.
  supports_generation?: boolean;
  // Upstream-only fields: the gateway clients are OpenAI/Anthropic SDKs that
  // do not consume these, but they pass through verbatim and the /v1/models
  // merge logic needs to read/write them.
  billing?: {
    is_premium?: boolean;
    multiplier?: number;
    restricted_to?: string[];
  };
  policy?: {
    state?: string;
    terms?: string;
  };
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}
