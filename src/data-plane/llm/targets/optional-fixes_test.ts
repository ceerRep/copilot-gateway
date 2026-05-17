import { assertEquals, assertExists } from "@std/assert";
import {
  defaultFixesFor,
  getFixCatalog,
  isKnownFixId,
} from "./optional-fixes.ts";

const FIX_ID_PATTERN = /^[a-z][a-z0-9-]+$/;

Deno.test("optional-fixes: every id is unique and well-formed", () => {
  const seen = new Set<string>();
  for (const entry of getFixCatalog()) {
    assertEquals(
      FIX_ID_PATTERN.test(entry.id),
      true,
      `Fix id "${entry.id}" violates ${FIX_ID_PATTERN.source}`,
    );
    assertEquals(seen.has(entry.id), false, `duplicate fix id ${entry.id}`);
    seen.add(entry.id);
  }
});

Deno.test("optional-fixes: defaultFor only references known UpstreamKind values", () => {
  const known = new Set(["copilot", "openai"]);
  for (const entry of getFixCatalog()) {
    for (const kind of entry.defaultFor) {
      assertEquals(
        known.has(kind),
        true,
        `Fix ${entry.id} has unknown defaultFor kind ${kind}`,
      );
    }
  }
});

Deno.test("optional-fixes: appliesTo is non-empty and lists known endpoints only", () => {
  const known = new Set(["messages", "responses", "chat_completions"]);
  for (const entry of getFixCatalog()) {
    assertEquals(
      entry.appliesTo.length > 0,
      true,
      `Fix ${entry.id} has empty appliesTo (would never be reachable)`,
    );
    for (const endpoint of entry.appliesTo) {
      assertEquals(
        known.has(endpoint),
        true,
        `Fix ${entry.id} has unknown appliesTo endpoint ${endpoint}`,
      );
    }
  }
});

Deno.test("optional-fixes: copilot defaults include retry-cyber-policy", () => {
  const copilotDefaults = defaultFixesFor("copilot");
  assertEquals(
    copilotDefaults.has("retry-cyber-policy"),
    true,
    "Copilot must keep retry-cyber-policy as a default fix (regression nail)",
  );
});

Deno.test("optional-fixes: openai kind has no defaults", () => {
  // No fix today opts into custom openai-compatible upstreams by default.
  // If this changes, also update the dashboard pre-fill assumption in
  // ui/dashboard/client.tsx openUpstreamModal().
  assertEquals(defaultFixesFor("openai").size, 0);
});

Deno.test("optional-fixes: isKnownFixId agrees with catalog", () => {
  for (const entry of getFixCatalog()) {
    assertEquals(isKnownFixId(entry.id), true);
  }
  assertEquals(isKnownFixId("nonexistent-fix"), false);
});

Deno.test("optional-fixes: deepseek-reasoning-dialect is in catalog and chat_completions-scoped", () => {
  const entry = getFixCatalog().find((e) =>
    e.id === "deepseek-reasoning-dialect"
  );
  assertExists(entry);
  assertEquals(entry.appliesTo, ["chat_completions"]);
  assertEquals(entry.defaultFor.length, 0);
});

Deno.test("optional-fixes: vendor-style flags are present, default off, span all LLM endpoints", () => {
  const vendorIds = [
    "vendor-deepseek",
    "vendor-qwen",
  ];
  for (const id of vendorIds) {
    const entry = getFixCatalog().find((e) => e.id === id);
    assertExists(entry, `vendor flag ${id} missing from catalog`);
    assertEquals(
      entry.defaultFor.length,
      0,
      `vendor flag ${id} must default off`,
    );
    assertEquals(
      [...entry.appliesTo].sort(),
      ["chat_completions", "messages", "responses"],
      `vendor flag ${id} must apply to all LLM endpoints (so it can be enabled on any LLM upstream)`,
    );
  }
});
