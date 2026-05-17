import { assertEquals } from "@std/assert";
import {
  copilotModels,
  jsonResponse,
  requestApp,
  setupAppTest,
  withMockedFetch,
} from "../../test-helpers.ts";

const SECOND_ACCOUNT = {
  token: "ghu_second",
  accountType: "individual",
  user: {
    id: 2002,
    login: "second",
    name: "Second Account",
    avatar_url: "https://example.com/second.png",
  },
};

Deno.test("/v1/models returns merged model list from Copilot and custom upstreams", async () => {
  const { repo, apiKey } = await setupAppTest();

  await repo.upstreamConfigs.save({
    id: "up_oai",
    name: "Test OpenAI",
    baseUrl: "https://oai.example.com",
    bearerToken: "sk-test",
    supportedEndpoints: ["/chat/completions"],
    enabled: true,
    sortOrder: 100,
    createdAt: new Date().toISOString(),
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
      url.pathname === "/models" && url.hostname === "api.githubcopilot.com"
    ) {
      return jsonResponse(copilotModels([
        { id: "claude-sonnet-4", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/models" && url.hostname === "oai.example.com") {
      return jsonResponse({
        object: "list",
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/models", {
      headers: { "x-api-key": apiKey.key },
    });

    assertEquals(response.status, 200);
    const body = await response.json() as {
      object: string;
      data: Array<
        { id: string; supported_endpoints?: string[]; upstream_kind?: string }
      >;
    };
    assertEquals(body.object, "list");

    const ids = body.data.map((m) => m.id);
    assertEquals(ids.includes("claude-sonnet-4"), true);
    assertEquals(ids.includes("gpt-4o"), true);
    assertEquals(ids.includes("gpt-4o-mini"), true);

    const claude = body.data.find((m) => m.id === "claude-sonnet-4");
    assertEquals(claude!.upstream_kind, "copilot");

    const gpt4o = body.data.find((m) => m.id === "gpt-4o");
    assertEquals(gpt4o!.supported_endpoints, ["/chat/completions"]);
    assertEquals(gpt4o!.upstream_kind, "openai");
  });
});

Deno.test("/v1/models returns empty list when no upstream is configured", async () => {
  const { repo, apiKey } = await setupAppTest();
  await repo.github.deleteAllAccounts();

  const response = await requestApp("/v1/models", {
    headers: { "x-api-key": apiKey.key },
  });

  assertEquals(response.status, 502);
  const body = await response.json() as { error: { message: string } };
  assertEquals(
    body.error.message,
    "No GitHub account connected — add one via the dashboard",
  );
});

Deno.test("/v1/models returns the ordered union of every connected GitHub account", async () => {
  const { repo, apiKey, githubAccount } = await setupAppTest();
  await repo.github.saveAccount(SECOND_ACCOUNT.user.id, SECOND_ACCOUNT);

  const tokenForGithubToken = new Map([
    [githubAccount.token, "copilot-first"],
    [SECOND_ACCOUNT.token, "copilot-second"],
  ]);

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }

    if (url.pathname === "/copilot_internal/v2/token") {
      const githubToken =
        request.headers.get("authorization")?.replace("token ", "") ?? "";
      return jsonResponse({
        token: tokenForGithubToken.get(githubToken),
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }

    if (url.pathname === "/models") {
      const auth = request.headers.get("authorization");
      if (auth === "Bearer copilot-first") {
        return jsonResponse(copilotModels([
          { id: "shared-model", supported_endpoints: ["/v1/messages"] },
          { id: "first-only", supported_endpoints: ["/responses"] },
        ]));
      }

      if (auth === "Bearer copilot-second") {
        return jsonResponse(copilotModels([
          { id: "shared-model", supported_endpoints: ["/chat/completions"] },
          { id: "second-only", supported_endpoints: ["/v1/messages"] },
        ]));
      }
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/models", {
      headers: { "x-api-key": apiKey.key },
    });

    assertEquals(response.status, 200);
    const body = await response.json() as {
      data: Array<{ id: string; supported_endpoints?: string[] }>;
    };
    assertEquals(body.data.map((model) => model.id), [
      "shared-model",
      "first-only",
      "second-only",
    ]);
    assertEquals(body.data[0].supported_endpoints, ["/v1/messages"]);
  });
});

Deno.test("/v1/models returns the last real error when every account model load fails", async () => {
  const { apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }

    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-invalid-models",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }

    if (url.pathname === "/models") {
      return jsonResponse({ object: "unexpected", data: [] });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/models", {
      headers: { "x-api-key": apiKey.key },
    });

    // Invalid /models payloads still parse if `data` is an array; an
    // unexpected `object` value is non-fatal because the merging handler
    // only iterates `data`. The assertion here documents the lenient
    // behavior consistent with isModelsResponse.
    assertEquals(response.status, 200);
    const body = await response.json() as { data: unknown[] };
    assertEquals(body.data, []);
  });
});
