import { getRepo } from "../repo/index.ts";

export interface GatewayConfig {
  codexAutoReviewModel: string | null;
}

const DEFAULT_CONFIG: GatewayConfig = {
  codexAutoReviewModel: null,
};

export const normalizeGatewayConfig = (raw: unknown): GatewayConfig => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  return {
    codexAutoReviewModel:
      typeof obj.codexAutoReviewModel === "string" &&
        obj.codexAutoReviewModel.length > 0
        ? obj.codexAutoReviewModel
        : null,
  };
};

export const loadGatewayConfig = async (): Promise<GatewayConfig> =>
  normalizeGatewayConfig(await getRepo().gatewayConfig.get());

export const saveGatewayConfig = async (
  config: unknown,
): Promise<GatewayConfig> => {
  const normalized = normalizeGatewayConfig(config);
  await getRepo().gatewayConfig.save(normalized);
  return normalized;
};
