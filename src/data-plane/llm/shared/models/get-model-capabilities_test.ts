import { assertEquals } from "@std/assert";
import {
  modelCapabilitiesFromModel,
  resolveEffectiveSupportedEndpoints,
} from "./get-model-capabilities.ts";
import type { ModelInfo } from "../../../../lib/models-cache.ts";

const baseModel = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "test-model",
  name: "Test",
  version: "1",
  object: "model",
  capabilities: {
    family: "test",
    type: "chat",
    limits: {},
    supports: {},
  },
  ...overrides,
});

const copilot = { kind: "copilot" as const, supportedEndpoints: [] };

Deno.test("modelCapabilitiesFromModel honors explicit supported_endpoints", () => {
  const caps = modelCapabilitiesFromModel(
    baseModel({
      supported_endpoints: ["/v1/messages", "/chat/completions"],
    }),
    copilot,
  );

  assertEquals(caps.supportsMessages, true);
  assertEquals(caps.supportsChatCompletions, true);
  assertEquals(caps.supportsResponses, false);
  assertEquals(caps.hasExplicitCapabilities, true);
});

Deno.test("modelCapabilitiesFromModel detects /responses support", () => {
  const caps = modelCapabilitiesFromModel(
    baseModel({
      supported_endpoints: ["/responses", "/chat/completions", "ws:/responses"],
    }),
    copilot,
  );

  assertEquals(caps.supportsResponses, true);
  assertEquals(caps.supportsChatCompletions, true);
  assertEquals(caps.supportsMessages, false);
});

Deno.test(
  "modelCapabilitiesFromModel infers chat completions when supported_endpoints is missing on a chat model",
  () => {
    // gpt-4o, gpt-4.1, and other legacy chat models still ship from
    // /chat/completions but no longer carry supported_endpoints in Copilot's
    // /models response.
    const caps = modelCapabilitiesFromModel(
      baseModel({ id: "gpt-4o" }),
      copilot,
    );

    assertEquals(caps.supportsChatCompletions, true);
    assertEquals(caps.supportsResponses, false);
    assertEquals(caps.supportsMessages, false);
    assertEquals(caps.hasExplicitCapabilities, false);
  },
);

Deno.test(
  "modelCapabilitiesFromModel does not infer chat completions for non-chat capability types",
  () => {
    const caps = modelCapabilitiesFromModel(
      baseModel({
        id: "text-embedding-3-small",
        capabilities: {
          family: "text-embedding-3-small",
          type: "embeddings",
          limits: {},
          supports: {},
        },
      }),
      copilot,
    );

    assertEquals(caps.supportsChatCompletions, false);
  },
);

Deno.test(
  "modelCapabilitiesFromModel honors an explicitly empty supported_endpoints array",
  () => {
    // If upstream ever ships an empty list we trust the declaration rather
    // than re-inferring from capabilities.type — that keeps us strict on
    // entries that intentionally opt out of every endpoint.
    const caps = modelCapabilitiesFromModel(
      baseModel({ supported_endpoints: [] }),
      copilot,
    );

    assertEquals(caps.supportsChatCompletions, false);
    assertEquals(caps.supportsResponses, false);
    assertEquals(caps.supportsMessages, false);
    assertEquals(caps.hasExplicitCapabilities, true);
  },
);

Deno.test("resolveEffectiveSupportedEndpoints returns per-model endpoints when present (copilot)", () => {
  const { endpoints, explicit } = resolveEffectiveSupportedEndpoints(
    ["/embeddings"],
    { kind: "copilot", supportedEndpoints: [] },
  );
  assertEquals(endpoints, ["/embeddings"]);
  assertEquals(explicit, true);
});

Deno.test("resolveEffectiveSupportedEndpoints returns per-model endpoints when present (openai)", () => {
  const { endpoints, explicit } = resolveEffectiveSupportedEndpoints(
    ["/v1/messages"],
    { kind: "openai", supportedEndpoints: ["/chat/completions", "/embeddings"] },
  );
  assertEquals(endpoints, ["/v1/messages"]);
  assertEquals(explicit, true);
});

Deno.test("resolveEffectiveSupportedEndpoints falls back to upstream config for openai", () => {
  const { endpoints, explicit } = resolveEffectiveSupportedEndpoints(
    undefined,
    { kind: "openai", supportedEndpoints: ["/chat/completions", "/embeddings"] },
  );
  assertEquals(endpoints, ["/chat/completions", "/embeddings"]);
  assertEquals(explicit, true);
});

Deno.test("resolveEffectiveSupportedEndpoints returns empty for copilot without per-model metadata", () => {
  const { endpoints, explicit } = resolveEffectiveSupportedEndpoints(
    undefined,
    { kind: "copilot", supportedEndpoints: [] },
  );
  assertEquals(endpoints, []);
  assertEquals(explicit, false);
});
