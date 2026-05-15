import { assertEquals, assertExists } from "@std/assert";
import { clearCopilotTokenCache } from "../../../../../lib/copilot.ts";
import { clearModelsCache } from "../../../../../lib/models-cache.ts";
import {
  copilotModels,
  jsonResponse,
  requestApp,
  setupAppTest,
  withMockedFetch,
} from "../../../../../test-helpers.ts";

function copilotTokenResponse() {
  return jsonResponse({
    token: "fake-copilot-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_in: 1800,
  });
}

Deno.test("/v1/messages/count_tokens proxies to Copilot upstream", async () => {
  const { apiKey } = await setupAppTest();
  let capturedPath = "";

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    capturedPath = url.pathname;
    return jsonResponse({ input_tokens: 42 });
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 42 });
    assertEquals(capturedPath, "/v1/messages/count_tokens");
  });
});

Deno.test("/messages/count_tokens aliases /v1/messages/count_tokens", async () => {
  const { apiKey } = await setupAppTest();
  let capturedPath = "";

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    capturedPath = url.pathname;
    return jsonResponse({ input_tokens: 24 });
  }, async () => {
    const response = await requestApp("/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 24 });
    assertEquals(capturedPath, "/v1/messages/count_tokens");
  });
});

Deno.test("/v1/messages/count_tokens resolves Claude compatibility models before proxying", async () => {
  const { apiKey } = await setupAppTest();
  let upstreamBody: Record<string, unknown> | undefined;

  await withMockedFetch(async (req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-opus-4.7", supported_endpoints: ["/v1/messages"] },
        {
          id: "claude-opus-4.7-1m-internal",
          supported_endpoints: ["/v1/messages"],
          maxContextWindowTokens: 1_000_000,
          maxPromptTokens: 936_000,
          maxOutputTokens: 64_000,
        },
      ]));
    }
    if (url.pathname === "/v1/messages/count_tokens") {
      upstreamBody = JSON.parse(await req.text()) as Record<string, unknown>;
      return jsonResponse({ input_tokens: 64 });
    }
    throw new Error(`Unhandled fetch ${req.url}`);
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
        "anthropic-beta": "context-1m-2025-08-07",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 64 });
  });

  assertEquals(upstreamBody?.model, "claude-opus-4.7-1m-internal");
});

Deno.test("/v1/messages/count_tokens rejects custom-upstream-only models", async () => {
  const { apiKey, repo } = await setupAppTest();
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  await repo.upstreamConfigs.save({
    id: "up_custom",
    name: "Custom Provider",
    baseUrl: "https://custom.example.com",
    bearerToken: "sk-custom",
    supportedEndpoints: ["/chat/completions"],
    enabled: true,
    sortOrder: 100,
    createdAt: "2026-05-01T00:00:00.000Z",
    reasoningDialect: "openai",
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);

    if (
      url.hostname === "custom.example.com" &&
      url.pathname === "/v1/models"
    ) {
      return jsonResponse({
        object: "list",
        data: [{ id: "custom-chat-model" }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "custom-chat-model",
        max_tokens: 100,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.type, "invalid_request_error");
    assertEquals(
      body.error.message.includes("only supported for Copilot-hosted models"),
      true,
    );
  });
});

Deno.test("/v1/messages/count_tokens rewrites virtual model with thinking disabled and output_config stripped", async () => {
  const { apiKey, repo } = await setupAppTest();
  await repo.gatewayConfig.save({ codexAutoReviewModel: "claude-sonnet-4" });

  let upstreamBody: Record<string, unknown> | undefined;

  await withMockedFetch(async (request) => {
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
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "claude-sonnet-4",
          supported_endpoints: ["/v1/messages"],
        },
      ]));
    }
    if (url.pathname === "/v1/messages/count_tokens") {
      upstreamBody = JSON.parse(await request.text()) as Record<
        string,
        unknown
      >;
      return jsonResponse({ input_tokens: 42 });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "codex-auto-review",
        max_tokens: 100,
        output_config: { effort: "high" },
        thinking: { type: "enabled", budget_tokens: 5000 },
        messages: [{ role: "user", content: "review this" }],
      }),
    });

    assertEquals(response.status, 200);
  });

  assertExists(upstreamBody);
  assertEquals(upstreamBody.model, "claude-sonnet-4");
  assertEquals(upstreamBody.thinking, { type: "disabled" });
  assertEquals("output_config" in upstreamBody, false);
});
