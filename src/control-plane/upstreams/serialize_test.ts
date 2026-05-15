import { assertEquals } from "@std/assert";
import {
  upstreamConfigToJson,
  upstreamConfigToFullJson,
} from "./serialize.ts";
import type { UpstreamConfig } from "../../repo/types.ts";

const sampleConfig: UpstreamConfig = {
  id: "up_test123",
  name: "Test Upstream",
  baseUrl: "https://api.example.com",
  bearerToken: "sk-secret-token-12345",
  supportedEndpoints: ["/chat/completions", "/responses"],
  enabled: true,
  sortOrder: 10,
  createdAt: "2026-04-29T00:00:00.000Z",
  reasoningDialect: "openai",
};

Deno.test("upstreamConfigToJson omits bearer token and includes bearer_token_set", () => {
  const result = upstreamConfigToJson(sampleConfig) as Record<string, unknown>;

  assertEquals(result.id, "up_test123");
  assertEquals(result.name, "Test Upstream");
  assertEquals(result.base_url, "https://api.example.com");
  assertEquals(result.bearer_token_set, true);
  assertEquals(result.bearer_token, undefined);
  assertEquals(result.supported_endpoints, ["/chat/completions", "/responses"]);
  assertEquals(result.enabled, true);
  assertEquals(result.sort_order, 10);
  assertEquals(result.created_at, "2026-04-29T00:00:00.000Z");
  assertEquals(result.reasoning_dialect, "openai");
  assertEquals(result.path_overrides, undefined);
});

Deno.test("upstreamConfigToJson reports bearer_token_set as false for empty token", () => {
  const result = upstreamConfigToJson({
    ...sampleConfig,
    bearerToken: "",
  });

  assertEquals(result.bearer_token_set, false);
});

Deno.test("upstreamConfigToJson surfaces reasoning_dialect and path_overrides when set", () => {
  const result = upstreamConfigToJson({
    ...sampleConfig,
    reasoningDialect: "deepseek",
    pathOverrides: { messages: "/api/v1/messages" },
  }) as Record<string, unknown>;

  assertEquals(result.reasoning_dialect, "deepseek");
  assertEquals(result.path_overrides, { messages: "/api/v1/messages" });
});

Deno.test("upstreamConfigToFullJson includes bearer token", () => {
  const result = upstreamConfigToFullJson(sampleConfig) as Record<string, unknown>;

  assertEquals(result.id, "up_test123");
  assertEquals(result.bearer_token, "sk-secret-token-12345");
  assertEquals(result.bearer_token_set, undefined);
  assertEquals(result.reasoning_dialect, "openai");
});
