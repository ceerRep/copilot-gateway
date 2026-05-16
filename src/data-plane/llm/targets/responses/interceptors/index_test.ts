// Order assertion for the Responses target assembler.

import { assertEquals } from "@std/assert";
import { stubUpstream } from "../../../../../test-helpers.ts";
import { responsesCopilotInterceptors } from "./copilot/index.ts";
import {
  interceptorsForResponses,
  responsesOptionalInterceptors,
} from "./index.ts";
import { withCyberPolicyRetried } from "./retry-cyber-policy.ts";

Deno.test("interceptorsForResponses on copilot kind: copilot block then retry-cyber-policy (Copilot default)", () => {
  // Copilot's enabledFixes is populated by defaultFixesFor("copilot") in
  // createCopilotUpstream, so retry-cyber-policy should land in the
  // optional tail.
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set(["retry-cyber-policy"]),
  });
  const assembled = interceptorsForResponses(upstream);

  assertEquals(
    assembled,
    [...responsesCopilotInterceptors, withCyberPolicyRetried],
  );
});

Deno.test("interceptorsForResponses on copilot kind with empty enabledFixes: only copilot block", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set<string>(),
  });
  const assembled = interceptorsForResponses(upstream);

  assertEquals(assembled, [...responsesCopilotInterceptors]);
});

Deno.test("interceptorsForResponses on openai kind: no copilot interceptors, opt-in only by enabledFixes", () => {
  const without = interceptorsForResponses(stubUpstream({
    kind: "openai",
    enabledFixes: new Set<string>(),
  }));
  assertEquals(without, []);
  for (const interceptor of responsesCopilotInterceptors) {
    assertEquals(without.includes(interceptor), false);
  }

  const withFix = interceptorsForResponses(stubUpstream({
    kind: "openai",
    enabledFixes: new Set(["retry-cyber-policy"]),
  }));
  assertEquals(withFix, [withCyberPolicyRetried]);
});

Deno.test("interceptorsForResponses ignores unknown enabledFixes silently at the assembler layer", () => {
  // Control plane rejects unknown ids on write; repo doesn't filter by
  // catalog on read, so unknown ids from older snapshots can reach the
  // assembler. The optional filter is a no-op on ids that don't match a
  // registered descriptor — confirm that behavior so a typo'd id doesn't
  // crash the assembler.
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set(["totally-made-up-fix"]),
  });
  assertEquals(interceptorsForResponses(upstream), []);
  // And the descriptor list itself isn't polluted with that id.
  const ids: readonly string[] = responsesOptionalInterceptors.map((d) =>
    d.fixId
  );
  assertEquals(ids.includes("totally-made-up-fix"), false);
});
