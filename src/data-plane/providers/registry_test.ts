import { assertEquals } from "@std/assert";
import {
  copilotModels,
  jsonResponse,
  setupAppTest,
  withMockedFetch,
} from "../../test-helpers.ts";
import { resolveModelForRequest } from "./registry.ts";

Deno.test("resolveModelForRequest applies provider-owned aliases only to that provider", async () => {
  const { githubAccount, repo } = await setupAppTest();

  await repo.upstreamConfigs.save({
    id: "up_custom",
    name: "Custom Provider",
    baseUrl: "https://custom.example.com",
    bearerToken: "sk-custom",
    supportedEndpoints: ["/v1/messages"],
    enabled: true,
    sortOrder: 100,
    createdAt: "2026-05-01T00:00:00.000Z",
    enabledFixes: [],
  });

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (
      url.hostname === "api.githubcopilot.com" && url.pathname === "/models"
    ) {
      return jsonResponse(copilotModels([
        { id: "claude-opus-4.7", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (
      url.hostname === "custom.example.com" && url.pathname === "/v1/models"
    ) {
      return jsonResponse({
        object: "list",
        data: [{ id: "claude-opus-4-7" }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const resolved = await resolveModelForRequest(
      "claude-opus-4-7-20251001",
    );

    assertEquals(resolved.id, "claude-opus-4-7");
    assertEquals(resolved.model?.supportedEndpoints, [
      "messages",
      "messages_count_tokens",
    ]);
    assertEquals(
      resolved.model?.providers.map(({ upstream }) => upstream),
      [`copilot:${githubAccount.user.id}`],
    );
  });
});

Deno.test("resolveModelForRequest matches cascaded gateway dashed Claude ids when caller sends dotted form", async () => {
  const { githubAccount, repo } = await setupAppTest();
  // Drop the seeded GitHub account so the cascaded upstream is the only
  // provider — this is the configuration where the dot/dash 404 bites.
  await repo.github.deleteAccount(githubAccount.user.id);

  await repo.upstreamConfigs.save({
    id: "up_cascaded",
    name: "Cascaded copilot-gateway",
    baseUrl: "https://cascaded.example.com",
    bearerToken: "sk-cascaded",
    supportedEndpoints: ["/v1/messages"],
    enabled: true,
    sortOrder: 100,
    createdAt: "2026-05-01T00:00:00.000Z",
    enabledFixes: [],
  });

  await withMockedFetch((request) => {
    const url = new URL(request.url);
    if (
      url.hostname === "cascaded.example.com" && url.pathname === "/v1/models"
    ) {
      // A cascaded copilot-gateway publishes the dashed public form, exactly
      // like this project's own /v1/models output after mergeClaudeVariants.
      return jsonResponse({
        object: "list",
        data: [{ id: "claude-sonnet-4-6" }],
      });
    }
    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    // Caller sends the dotted upstream form. The exact-id Map misses, the
    // OpenAI provider has no resolveRequestedModelId hook, so without the
    // dot/dash fallback this 404s with "No upstream provides model …".
    const dotted = await resolveModelForRequest("claude-sonnet-4.6");
    assertEquals(dotted.id, "claude-sonnet-4-6");
    assertEquals(
      dotted.model?.providers.map(({ upstream }) => upstream),
      ["openai:up_cascaded"],
    );

    // Sanity: the dashed form still works (exact-id hit).
    const dashed = await resolveModelForRequest("claude-sonnet-4-6");
    assertEquals(dashed.id, "claude-sonnet-4-6");
    assertEquals(
      dashed.model?.providers.map(({ upstream }) => upstream),
      ["openai:up_cascaded"],
    );
  });
});

Deno.test("collectProviderModels merges Copilot and cascaded Claude bindings into one Model", async () => {
  const { githubAccount, repo } = await setupAppTest();

  await repo.upstreamConfigs.save({
    id: "up_cascaded",
    name: "Cascaded copilot-gateway",
    baseUrl: "https://cascaded.example.com",
    bearerToken: "sk-cascaded",
    supportedEndpoints: ["/v1/messages"],
    enabled: true,
    sortOrder: 100,
    createdAt: "2026-05-01T00:00:00.000Z",
    enabledFixes: [],
  });

  await withMockedFetch((request) => {
    const url = new URL(request.url);
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (
      url.hostname === "api.githubcopilot.com" && url.pathname === "/models"
    ) {
      // Copilot publishes the dotted upstream id; mergeClaudeVariants
      // normalizes it to the dashed public form inside the provider.
      return jsonResponse(copilotModels([
        { id: "claude-sonnet-4.6", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (
      url.hostname === "cascaded.example.com" && url.pathname === "/v1/models"
    ) {
      return jsonResponse({
        object: "list",
        data: [{ id: "claude-sonnet-4-6" }],
      });
    }
    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const resolved = await resolveModelForRequest("claude-sonnet-4-6");
    assertEquals(resolved.id, "claude-sonnet-4-6");
    // Both bindings share one Model so the provider-attempt loop can fall
    // through to the cascaded upstream if the Copilot binding skips.
    assertEquals(
      resolved.model?.providers.map(({ upstream }) => upstream).sort(),
      [`copilot:${githubAccount.user.id}`, "openai:up_cascaded"].sort(),
    );
  });
});
