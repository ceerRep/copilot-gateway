import { assertEquals } from "@std/assert";
import { clearCopilotTokenCache } from "../copilot.ts";
import { clearModelsCache } from "../models-cache.ts";
import { listAllUpstreams, resolveUpstreamForModel } from "./resolver.ts";
import { jsonResponse, setupAppTest, withMockedFetch } from "../../test-helpers.ts";
import { getRepo } from "../../repo/index.ts";
import type { UpstreamConfig } from "../../repo/types.ts";

const customConfig = (overrides: Partial<UpstreamConfig> = {}): UpstreamConfig => ({
  id: "up_test",
  name: "Test OpenAI",
  baseUrl: "https://oai.example.com",
  bearerToken: "sk-test",
  supportedEndpoints: ["/chat/completions"],
  enabled: true,
  sortOrder: 100,
  createdAt: "2026-04-29T00:00:00.000Z",
  reasoningDialect: "openai",
  ...overrides,
});

Deno.test("resolveUpstreamForModel returns null when nothing is configured", async () => {
  const { repo } = await setupAppTest();
  // Strip the GitHub account that setupAppTest seeded.
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  const resolution = await resolveUpstreamForModel("anything");
  assertEquals(resolution, null);
});

Deno.test("resolveUpstreamForModel routes to a custom upstream when GitHub is absent", async () => {
  const { repo } = await setupAppTest();
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  await getRepo().upstreamConfigs.save(customConfig());

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "oai.example.com" && url.pathname === "/v1/models") {
      return jsonResponse({
        object: "list",
        data: [{ id: "gpt-4-test" }],
      });
    }
    throw new Error(`Unhandled fetch ${req.url}`);
  }, async () => {
    const resolution = await resolveUpstreamForModel("gpt-4-test");
    assertEquals(resolution !== null, true);
    assertEquals(resolution!.kind, "openai");
    if (resolution!.kind === "openai") {
      assertEquals(resolution!.upstream.id, "up_test");
    }
  });
});

Deno.test("resolveUpstreamForModel prefers Copilot when its /models declares the id first", async () => {
  const { githubAccount: _gh } = await setupAppTest();
  clearModelsCache();
  await clearCopilotTokenCache();

  await getRepo().upstreamConfigs.save(customConfig());

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "update.code.visualstudio.com") return jsonResponse(["1.110.1"]);
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-tok", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.hostname === "api.githubcopilot.com" && url.pathname === "/models") {
      return jsonResponse({
        object: "list",
        data: [{ id: "shared-model", supported_endpoints: ["/v1/messages"] }],
      });
    }
    if (url.hostname === "oai.example.com" && url.pathname === "/v1/models") {
      return jsonResponse({
        object: "list",
        data: [{ id: "shared-model" }],
      });
    }
    throw new Error(`Unhandled fetch ${req.url}`);
  }, async () => {
    const resolution = await resolveUpstreamForModel("shared-model");
    assertEquals(resolution !== null, true);
    assertEquals(resolution!.kind, "copilot");
  });
});

Deno.test("resolveUpstreamForModel skips disabled custom upstreams", async () => {
  const { repo } = await setupAppTest();
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  await getRepo().upstreamConfigs.save(customConfig({ enabled: false }));

  const upstreams = await listAllUpstreams();
  assertEquals(upstreams.length, 0);

  const resolution = await resolveUpstreamForModel("gpt-4-test");
  assertEquals(resolution, null);
});
