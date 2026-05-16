// Order assertion for the Chat Completions target assembler.

import { assertEquals } from "@std/assert";
import { stubUpstream } from "../../../../../test-helpers.ts";
import { withUsageStreamOptionsIncluded } from "./include-usage-stream-options.ts";
import { withDeepseekReasoningDialect } from "./normalize-reasoning-dialect.ts";
import { withUsageNormalized } from "./normalize-usage.ts";
import { interceptorsForChatCompletions } from "./index.ts";

Deno.test("interceptorsForChatCompletions on copilot kind: base only (no copilot subdir today)", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set<string>(),
  });
  assertEquals(
    interceptorsForChatCompletions(upstream),
    [withUsageStreamOptionsIncluded, withUsageNormalized],
  );
});

Deno.test("interceptorsForChatCompletions on openai kind with deepseek dialect enabled", () => {
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set(["deepseek-reasoning-dialect"]),
  });
  assertEquals(
    interceptorsForChatCompletions(upstream),
    [withUsageStreamOptionsIncluded, withUsageNormalized, withDeepseekReasoningDialect],
  );
});

Deno.test("interceptorsForChatCompletions on openai kind without enabledFixes: base only", () => {
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set<string>(),
  });
  assertEquals(
    interceptorsForChatCompletions(upstream),
    [withUsageStreamOptionsIncluded, withUsageNormalized],
  );
});
