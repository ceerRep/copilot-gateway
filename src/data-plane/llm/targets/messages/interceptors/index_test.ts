// Order assertion for the Messages target assembler: base ++ copilot ++
// optional. The dispatcher (runTargetInterceptors) executes whatever order
// the assembler returns, so this is the contract guarding interceptor
// ordering across future refactors.

import { assertEquals } from "@std/assert";
import { stubUpstream } from "../../../../../test-helpers.ts";
import { messagesCopilotInterceptors } from "./copilot/index.ts";
import {
  interceptorsForMessages,
  messagesOptionalInterceptors,
} from "./index.ts";

Deno.test("interceptorsForMessages on copilot kind: copilot interceptors only (no base or optional today)", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set<string>(),
  });
  const assembled = interceptorsForMessages(upstream);

  assertEquals(assembled, [...messagesCopilotInterceptors]);
});

Deno.test("interceptorsForMessages on openai kind: empty assembly (no base, no copilot, no optional today)", () => {
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set<string>(),
  });
  const assembled = interceptorsForMessages(upstream);

  assertEquals(assembled, []);
  for (const interceptor of messagesCopilotInterceptors) {
    assertEquals(
      assembled.includes(interceptor),
      false,
      "openai upstreams must not pick up Copilot-only interceptors",
    );
  }
});

Deno.test("interceptorsForMessages includes opted-in optional interceptors after copilot block", () => {
  // No Messages-target optional interceptors exist today; verify the slot
  // is empty so future additions explicitly update this test.
  assertEquals(messagesOptionalInterceptors.length, 0);
});
