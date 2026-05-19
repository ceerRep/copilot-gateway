import { getRepo } from "../../repo/index.ts";
import { createOpenAiUpstream } from "../../shared/upstream/openai.ts";
import {
  copilotSupportsGeneration,
  endpointsIncludeLlmGeneration,
  resolveEffectiveSupportedEndpoints,
} from "../llm/shared/models/get-model-capabilities.ts";
import {
  loadModels,
  loadModelsForAccount,
  type ModelsResponse,
} from "./cache.ts";
import { mergeClaudeVariants } from "./merge.ts";

export const loadMergedModels = async (): Promise<ModelsResponse> => {
  const accounts = await getRepo().github.listAccounts();
  const byId = new Map<string, ModelsResponse["data"][number]>();
  let sawSuccess = false;
  let lastError: unknown = null;

  for (const account of accounts) {
    const result = await loadModelsForAccount(account);
    if (result.type === "error") {
      lastError = result.error;
      continue;
    }

    sawSuccess = true;
    for (const model of result.data.data) {
      if (!model.id || byId.has(model.id)) continue;
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
      if (!model.id || byId.has(model.id)) continue;
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

  if (lastError) throw lastError;
  throw new Error("No GitHub account connected — add one via the dashboard");
};
