import { loadGatewayConfig } from "../../../../lib/gateway-config.ts";

export interface VirtualModelResolution {
  targetModel: string;
  disableReasoning: boolean;
}

export const resolveVirtualModel = async (
  model: string,
): Promise<VirtualModelResolution | null> => {
  if (model !== "codex-auto-review") return null;
  const config = await loadGatewayConfig();
  if (!config.codexAutoReviewModel) return null;
  return { targetModel: config.codexAutoReviewModel, disableReasoning: true };
};
