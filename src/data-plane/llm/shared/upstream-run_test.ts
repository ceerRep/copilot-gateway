import { assertEquals } from "@std/assert";
import { stubUpstream } from "../../../test-helpers.ts";
import { withDefaultFixes } from "./upstream-run.ts";

Deno.test("withDefaultFixes: copilot upstream with empty enabledFixes gets defaults merged in", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set<string>(),
  });
  const wrapped = withDefaultFixes(upstream);

  // retry-cyber-policy is the current Copilot default in the catalog;
  // this nails down the regression-prone "Copilot must keep retry on
  // cyber-policy block" invariant at the merge layer.
  assertEquals(wrapped.enabledFixes.has("retry-cyber-policy"), true);
});

Deno.test("withDefaultFixes: admin opt-ins on a copilot upstream stack with kind defaults", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set(["vendor-deepseek"]),
  });
  const wrapped = withDefaultFixes(upstream);

  assertEquals(wrapped.enabledFixes.has("retry-cyber-policy"), true);
  assertEquals(wrapped.enabledFixes.has("vendor-deepseek"), true);
});

Deno.test("withDefaultFixes: openai upstream with no matching defaults returns input unchanged", () => {
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set(["vendor-qwen"]),
  });
  const wrapped = withDefaultFixes(upstream);

  // Today no flag has defaultFor including "openai"; the helper
  // short-circuits and returns the same object reference.
  assertEquals(wrapped, upstream);
});
