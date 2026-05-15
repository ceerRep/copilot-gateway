import type { Context } from "hono";
import {
  loadGatewayConfig,
  saveGatewayConfig,
} from "../../lib/gateway-config.ts";

export const getGatewayConfigRoute = async (c: Context) =>
  c.json(await loadGatewayConfig());

export const putGatewayConfigRoute = async (c: Context) => {
  const body: unknown = await c.req.json();
  const config = await saveGatewayConfig(body);
  return c.json(config);
};
