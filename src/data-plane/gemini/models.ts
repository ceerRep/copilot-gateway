import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../lib/copilot.ts";
import {
  loadModels,
  loadModelsForAccount,
  type ModelInfo,
  ModelsFetchError,
  type ModelsResponse,
} from "../../lib/models-cache.ts";
import type {
  GeminiGenerationMethod,
  GeminiModel,
} from "../../lib/gemini-types.ts";
import { getRepo } from "../../repo/index.ts";
import { createOpenAiUpstream } from "../../lib/upstream/openai.ts";
import {
  copilotSupportsGeneration,
  endpointsIncludeLlmGeneration,
  resolveEffectiveSupportedEndpoints,
} from "../llm/shared/models/get-model-capabilities.ts";
import { mergeClaudeVariants } from "../models/merge.ts";

const supportsLlmGeneration = (model: ModelInfo): boolean =>
  model.supports_generation ??
    (model.supported_endpoints
      ? endpointsIncludeLlmGeneration(model.supported_endpoints)
      : true);

const displayNameForModel = (model: ModelInfo): string =>
  model.name || model.id;

const inputLimitForModel = (model: ModelInfo): number | undefined => {
  const limits = model.capabilities?.limits;
  return limits?.max_prompt_tokens ?? limits?.max_context_window_tokens;
};

const outputLimitForModel = (model: ModelInfo): number | undefined =>
  model.capabilities?.limits?.max_output_tokens ??
    model.capabilities?.limits?.max_non_streaming_output_tokens;

const toGeminiModel = (model: ModelInfo): GeminiModel => {
  const methods: GeminiGenerationMethod[] = [
    "generateContent",
    "streamGenerateContent",
  ];
  if (model.upstream_kind !== "openai") methods.push("countTokens");
  return {
    name: `models/${model.id}`,
    baseModelId: model.id,
    displayName: displayNameForModel(model),
    supportedGenerationMethods: methods,
    ...(inputLimitForModel(model) !== undefined
      ? { inputTokenLimit: inputLimitForModel(model) }
      : {}),
    ...(outputLimitForModel(model) !== undefined
      ? { outputTokenLimit: outputLimitForModel(model) }
      : {}),
    temperature: 1,
    topP: 0.95,
    topK: 40,
  };
};

const geminiStatusForHttpStatus = (status: number): string => {
  switch (status) {
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "PERMISSION_DENIED";
    case 404:
      return "NOT_FOUND";
    case 429:
      return "RESOURCE_EXHAUSTED";
    case 502:
    case 503:
      return "UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL" : "INVALID_ARGUMENT";
  }
};

const geminiError = (status: number, message: string): Response => {
  const code = status >= 400 && status <= 599 ? status : 500;
  return Response.json({
    error: { code, message, status: geminiStatusForHttpStatus(code) },
  }, { status: code });
};

const upstreamErrorResponse = (error: unknown): Response | null => {
  if (error instanceof ModelsFetchError) {
    return geminiError(error.status, error.body);
  }

  if (isCopilotTokenFetchError(error)) {
    return geminiError(error.status, error.body);
  }

  return null;
};

const loadMergedModels = async (): Promise<ModelsResponse> => {
  const byId = new Map<string, ModelsResponse["data"][number]>();
  let sawSuccess = false;
  let lastError: unknown = null;

  const accounts = await getRepo().github.listAccounts();
  for (const account of accounts) {
    const result = await loadModelsForAccount(account);
    if (result.type === "error") {
      lastError = result.error;
      continue;
    }
    sawSuccess = true;
    for (const model of result.data.data) {
      if (!model?.id || byId.has(model.id)) continue;
      byId.set(model.id, {
        ...model,
        upstream_kind: "copilot",
        supports_generation: copilotSupportsGeneration(model),
      });
    }
  }

  const customConfigs = await getRepo().upstreamConfigs.list();
  for (const config of customConfigs) {
    if (!config.enabled) continue;
    const upstream = createOpenAiUpstream(config);
    const result = await loadModels(upstream);
    if (result.type === "error") {
      lastError = result.error;
      continue;
    }
    sawSuccess = true;
    for (const model of result.data.data) {
      if (!model?.id || byId.has(model.id)) continue;
      const { endpoints: supported_endpoints } =
        resolveEffectiveSupportedEndpoints(
          model.supported_endpoints,
          upstream,
        );
      byId.set(model.id, {
        ...model,
        supported_endpoints,
        upstream_kind: "openai",
        supports_generation: endpointsIncludeLlmGeneration(supported_endpoints),
      });
    }
  }

  if (sawSuccess) {
    return mergeClaudeVariants({ object: "list", data: [...byId.values()] });
  }

  const upstream = upstreamErrorResponse(lastError);
  if (upstream) throw upstream;
  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "No GitHub account connected - add one via the dashboard",
  );
};

const loadGeminiModels = async (): Promise<GeminiModel[]> => {
  const models = await loadMergedModels();
  return models.data.filter(supportsLlmGeneration).map(toGeminiModel);
};

export const serveGeminiModels = async (_c: Context): Promise<Response> => {
  try {
    return Response.json({ models: await loadGeminiModels() });
  } catch (error) {
    if (error instanceof Response) return error;
    return geminiError(
      502,
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const serveGeminiModelInfo = async (
  c: Context,
): Promise<Response> => {
  const rawModelId = c.req.param("modelId");
  if (!rawModelId) return geminiError(404, "Model not found: ");

  const modelId = rawModelId.replace(/^models\//, "");
  try {
    const model = (await loadGeminiModels()).find((candidate) =>
      candidate.baseModelId === modelId ||
      candidate.name === `models/${modelId}`
    );
    if (!model) return geminiError(404, `Model not found: ${modelId}`);
    return Response.json(model);
  } catch (error) {
    if (error instanceof Response) return error;
    return geminiError(
      502,
      error instanceof Error ? error.message : String(error),
    );
  }
};
