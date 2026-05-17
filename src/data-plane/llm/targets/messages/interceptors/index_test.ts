// Order assertion for the Messages target assembler: base ++ copilot ++
// optional. The dispatcher (runTargetInterceptors) executes whatever order
// the assembler returns, so this is the contract guarding interceptor
// ordering across future refactors.

import { assertEquals } from "@std/assert";
import { stubUpstream } from "../../../../../test-helpers.ts";
import { messagesCopilotInterceptors } from "./copilot/index.ts";
import { withReasoningDisabledOnForcedToolChoice } from "./disable-reasoning-on-forced-tool-choice.ts";
import {
  interceptorsForMessages,
  messagesOptionalInterceptors,
} from "./index.ts";

Deno.test("interceptorsForMessages on copilot kind without opt-ins: copilot interceptors only", () => {
  const upstream = stubUpstream({
    kind: "copilot",
    enabledFixes: new Set<string>(),
  });
  const assembled = interceptorsForMessages(upstream);

  assertEquals(assembled, [...messagesCopilotInterceptors]);
});

Deno.test("interceptorsForMessages on openai kind without opt-ins: empty assembly", () => {
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

Deno.test("interceptorsForMessages picks up disable-reasoning-on-forced-tool-choice when opted in", () => {
  const upstream = stubUpstream({
    kind: "openai",
    enabledFixes: new Set(["disable-reasoning-on-forced-tool-choice"]),
  });
  assertEquals(
    interceptorsForMessages(upstream),
    [withReasoningDisabledOnForcedToolChoice],
  );
});

Deno.test("messagesOptionalInterceptors registers disable-reasoning-on-forced-tool-choice", () => {
  const descriptor = messagesOptionalInterceptors.find(
    (d) => d.fixId === "disable-reasoning-on-forced-tool-choice",
  );
  if (!descriptor) throw new Error("expected interceptor to be registered");
});
