import { assertEquals } from "@std/assert";
import { clearCopilotTokenCache } from "../../lib/copilot.ts";
import { clearModelsCache } from "../../lib/models-cache.ts";
import {
  copilotModels,
  jsonResponse,
  requestApp,
  setupAppTest,
  withMockedFetch,
} from "../../test-helpers.ts";

Deno.test("/v1beta/models lists Copilot LLM models in Gemini model shape", async () => {
  const { apiKey } = await setupAppTest();

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
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "gpt-gemini-list",
          supported_endpoints: ["/chat/completions"],
          maxPromptTokens: 12345,
          maxOutputTokens: 678,
        },
        { id: "embedding-only", supported_endpoints: ["/embeddings"] },
      ]));
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1beta/models", {
      headers: { "x-api-key": apiKey.key },
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.models, [{
      name: "models/gpt-gemini-list",
      baseModelId: "gpt-gemini-list",
      displayName: "gpt-gemini-list",
      supportedGenerationMethods: [
        "generateContent",
        "streamGenerateContent",
        "countTokens",
      ],
      inputTokenLimit: 12345,
      outputTokenLimit: 678,
      temperature: 1,
      topP: 0.95,
      topK: 40,
    }]);
  });
});

Deno.test("/v1beta/models/:modelId returns one Gemini model or Google RPC 404", async () => {
  const { apiKey } = await setupAppTest();

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
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-gemini-get", supported_endpoints: ["/v1/messages"] },
      ]));
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const found = await requestApp("/v1beta/models/gpt-gemini-get", {
      headers: { "x-api-key": apiKey.key },
    });
    assertEquals(found.status, 200);
    const model = await found.json();
    assertEquals(model.name, "models/gpt-gemini-get");
    assertEquals(model.supportedGenerationMethods, [
      "generateContent",
      "streamGenerateContent",
      "countTokens",
    ]);

    const missing = await requestApp("/v1beta/models/missing-model", {
      headers: { "x-api-key": apiKey.key },
    });
    assertEquals(missing.status, 404);
    assertEquals(await missing.json(), {
      error: {
        code: 404,
        message: "Model not found: missing-model",
        status: "NOT_FOUND",
      },
    });
  });
});

Deno.test("/v1beta/models includes custom upstream LLM models", async () => {
  const { apiKey, repo } = await setupAppTest();
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  await repo.upstreamConfigs.save({
    id: "up_custom",
    name: "Custom LLM",
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
        data: [{ id: "custom-llm-model", name: "Custom LLM Model" }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const listResp = await requestApp("/v1beta/models", {
      headers: { "x-api-key": apiKey.key },
    });
    assertEquals(listResp.status, 200);
    const list = await listResp.json();
    assertEquals(list.models.length, 1);
    assertEquals(list.models[0].name, "models/custom-llm-model");
    assertEquals(list.models[0].displayName, "Custom LLM Model");

    const getResp = await requestApp("/v1beta/models/custom-llm-model", {
      headers: { "x-api-key": apiKey.key },
    });
    assertEquals(getResp.status, 200);
    const model = await getResp.json();
    assertEquals(model.name, "models/custom-llm-model");
  });
});

Deno.test("/v1beta/models excludes custom upstream embedding-only models", async () => {
  const { apiKey, repo } = await setupAppTest();
  await repo.github.deleteAllAccounts();
  clearModelsCache();
  await clearCopilotTokenCache();

  await repo.upstreamConfigs.save({
    id: "up_embed",
    name: "Embedding Provider",
    baseUrl: "https://embed.example.com",
    bearerToken: "sk-embed",
    supportedEndpoints: ["/embeddings"],
    enabled: true,
    sortOrder: 100,
    createdAt: "2026-05-01T00:00:00.000Z",
    reasoningDialect: "openai",
  });

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);

    if (
      url.hostname === "embed.example.com" &&
      url.pathname === "/v1/models"
    ) {
      return jsonResponse({
        object: "list",
        data: [{ id: "embed-only-model" }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const listResp = await requestApp("/v1beta/models", {
      headers: { "x-api-key": apiKey.key },
    });
    assertEquals(listResp.status, 200);
    const list = await listResp.json();
    assertEquals(list.models.length, 0);
  });
});
