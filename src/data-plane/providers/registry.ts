import { getRepo } from "../../repo/index.ts";
import { createCopilotProvider } from "./copilot/provider.ts";
import { endpointsIncludeLlmGeneration } from "./endpoints.ts";
import { createOpenAiProvider } from "./openai/provider.ts";
import type { Model, ModelEndpoint, ModelProviderInstance } from "./types.ts";

// Dot/dash-insensitive canonical form for Claude ids. A cascaded
// copilot-gateway exposes claude ids in dashed public form
// (claude-sonnet-4-7) while Copilot's native /models is dotted
// (claude-sonnet-4.7); both forms must resolve to the same Model regardless
// of which side a caller hits. Strips ONLY the dot/dash distinction — date
// suffixes and variant suffixes are intentionally preserved so the alias path
// keeps owning that rewrite (and its provider-scoping). Non-claude ids pass
// through unchanged.
const claudeDotDashKey = (id: string): string =>
  id.startsWith("claude-") ? id.replace(/(\d)\.(\d)/g, "$1-$2") : id;

interface ProviderModelsResult {
  models: Model[];
  sawSuccess: boolean;
  lastError: unknown;
}

export const listModelProviders = async (): Promise<
  ModelProviderInstance[]
> => {
  const providers: ModelProviderInstance[] = [];

  const accounts = await getRepo().github.listAccounts();
  for (const account of accounts) {
    providers.push(await createCopilotProvider(account));
  }

  const customConfigs = await getRepo().upstreamConfigs.list();
  for (const config of customConfigs) {
    if (!config.enabled) continue;
    providers.push(createOpenAiProvider(config));
  }

  return providers;
};

const unionEndpoints = (
  a: readonly ModelEndpoint[],
  b: readonly ModelEndpoint[],
): ModelEndpoint[] => {
  const result = [...a];
  for (const endpoint of b) {
    if (!result.includes(endpoint)) result.push(endpoint);
  }
  return result;
};

const collectProviderModels = async (
  providers: readonly ModelProviderInstance[],
): Promise<ProviderModelsResult> => {
  const byId = new Map<string, Model>();
  // For claude-* ids we also key by canonical (dashed public) form so a
  // Copilot account (publishing dotted upstream ids in some legacy paths) and
  // a cascaded copilot-gateway (publishing dashed public ids) merge into one
  // Model with both bindings, instead of becoming two separate entries.
  const claudeCanonicalToId = new Map<string, string>();
  let sawSuccess = false;
  let lastError: unknown = null;

  for (const instance of providers) {
    try {
      const providedModels = await instance.provider.getProvidedModels();
      sawSuccess = true;
      for (const upstreamModel of providedModels) {
        if (!upstreamModel.id) continue;
        const {
          providerData: _providerData,
          supportedEndpoints: upstreamSupportedEndpoints,
          ...modelInfo
        } = upstreamModel;
        const canonical = upstreamModel.id.startsWith("claude-")
          ? claudeDotDashKey(upstreamModel.id)
          : undefined;
        const existingKey = canonical
          ? claudeCanonicalToId.get(canonical) ?? upstreamModel.id
          : upstreamModel.id;
        const existing = byId.get(existingKey);
        if (!existing) {
          byId.set(upstreamModel.id, {
            ...modelInfo,
            supportedEndpoints: [...upstreamSupportedEndpoints],
            supports_generation: endpointsIncludeLlmGeneration(
              upstreamSupportedEndpoints,
            ),
            providers: [{
              upstream: instance.upstream,
              provider: instance.provider,
              upstreamModel,
              enabledFixes: instance.enabledFixes,
              sourceInterceptors: instance.sourceInterceptors,
              targetInterceptors: instance.targetInterceptors,
            }],
          });
          if (canonical) claudeCanonicalToId.set(canonical, upstreamModel.id);
          continue;
        }

        // Known limitation for this refactor: when multiple providers expose
        // the same public model id, the first provider's metadata remains the
        // public /models metadata. Runtime execution still uses the selected
        // provider's own UpstreamModel, so capability-sensitive calls do not
        // depend on this merged view being perfectly representative.
        byId.set(existingKey, {
          ...existing,
          supportedEndpoints: unionEndpoints(
            existing.supportedEndpoints,
            upstreamSupportedEndpoints,
          ),
          supports_generation: endpointsIncludeLlmGeneration(
            unionEndpoints(
              existing.supportedEndpoints,
              upstreamSupportedEndpoints,
            ),
          ),
          providers: [...existing.providers, {
            upstream: instance.upstream,
            provider: instance.provider,
            upstreamModel,
            enabledFixes: instance.enabledFixes,
            sourceInterceptors: instance.sourceInterceptors,
            targetInterceptors: instance.targetInterceptors,
          }],
        });
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { models: [...byId.values()], sawSuccess, lastError };
};

const modelWithProviderSet = (
  model: Model,
  providers: ReadonlySet<ModelProviderInstance>,
): Model => {
  const bindings = model.providers.filter((binding) =>
    [...providers].some((instance) =>
      instance.upstream === binding.upstream &&
      instance.provider === binding.provider
    )
  );
  const supportedEndpoints = bindings.reduce<ModelEndpoint[]>(
    (endpoints, binding) =>
      unionEndpoints(endpoints, binding.upstreamModel.supportedEndpoints),
    [],
  );

  return {
    ...model,
    supportedEndpoints,
    supports_generation: endpointsIncludeLlmGeneration(supportedEndpoints),
    providers: bindings,
  };
};

export const getModels = async (): Promise<Model[]> => {
  const providers = await listModelProviders();
  if (providers.length === 0) {
    throw new Error(
      "No upstream provider configured — connect GitHub Copilot or add a custom upstream in the dashboard",
    );
  }

  const { models, sawSuccess, lastError } = await collectProviderModels(
    providers,
  );

  if (sawSuccess) return models;
  if (lastError) throw lastError;
  return [];
};

export interface ModelResolution {
  id: string;
  model?: Model;
}

const resolveProviderAlias = (
  providers: readonly ModelProviderInstance[],
  byId: ReadonlyMap<string, Model>,
  modelId: string,
): Model | undefined => {
  let resolved: Model | undefined;
  const providersForAlias = new Set<ModelProviderInstance>();

  for (const instance of providers) {
    const aliasTarget = instance.resolveRequestedModelId?.(modelId);
    if (!aliasTarget || aliasTarget === modelId) continue;

    const model = byId.get(aliasTarget);
    if (!model) continue;
    if (resolved && resolved.id !== model.id) continue;

    const providerHasModel = model.providers.some((binding) =>
      binding.upstream === instance.upstream &&
      binding.provider === instance.provider
    );
    if (!providerHasModel) continue;

    resolved = model;
    providersForAlias.add(instance);
  }

  if (!resolved) return undefined;
  return modelWithProviderSet(resolved, providersForAlias);
};

export const resolveModelForRequest = async (
  modelId: string,
): Promise<ModelResolution> => {
  const providers = await listModelProviders();
  if (providers.length === 0) {
    throw new Error(
      "No upstream provider configured — connect GitHub Copilot or add a custom upstream in the dashboard",
    );
  }

  const { models, lastError } = await collectProviderModels(providers);
  const byId = new Map(models.map((model) => [model.id, model]));

  const exact = byId.get(modelId);
  if (exact) return { id: exact.id, model: exact };

  // Fall back to dot/dash-insensitive Claude lookup before alias resolution:
  // an OpenAI-compatible upstream (notably a cascaded copilot-gateway) only
  // gets its alias normalization through its provider's own /models view, not
  // through resolveProviderAlias, so a caller sending the opposite form of
  // what the upstream publishes must still resolve.
  if (modelId.startsWith("claude-")) {
    const canonical = claudeDotDashKey(modelId);
    for (const model of models) {
      if (
        model.id.startsWith("claude-") &&
        claudeDotDashKey(model.id) === canonical
      ) {
        return { id: model.id, model };
      }
    }
  }

  const alias = resolveProviderAlias(providers, byId, modelId);
  if (alias) return { id: alias.id, model: alias };

  if (lastError) throw lastError;

  return { id: modelId };
};
