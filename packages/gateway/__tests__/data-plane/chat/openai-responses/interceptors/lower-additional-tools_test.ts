import { test } from 'vitest';

import { withAdditionalToolsLowered } from '../../../../../src/data-plane/chat/openai-responses/interceptors/lower-additional-tools.ts';
import type { OpenAIResponsesInvocation } from '../../../../../src/data-plane/chat/openai-responses/interceptors/types.ts';
import { mockChatGatewayCtx } from '../../../../test-utils/gateway-ctx.ts';
import type { ChatTargetApi, FlagId } from '@floway-dev/provider';
import { eventResult } from '@floway-dev/provider';
import { assertEquals, stubModelCandidate, testTelemetryModelIdentity } from '@floway-dev/test-utils';

const stubCtx = mockChatGatewayCtx();
const okEvents = () => Promise.resolve(eventResult((async function* () {})(), testTelemetryModelIdentity));
const tool = { type: 'function' as const, name: 'lookup', parameters: { type: 'object' } };

const invocation = (targetApi: ChatTargetApi, enabledFlags: ReadonlySet<FlagId>): OpenAIResponsesInvocation => ({
  payload: {
    model: 'm',
    input: [
      { type: 'additional_tools', role: 'developer', tools: [tool] },
      { type: 'message', role: 'user', content: 'hi' },
    ],
  },
  candidate: stubModelCandidate({ enabledFlags }),
  targetApi,
  headers: new Headers(),
  action: 'generate',
});

test.each(['anthropicMessages', 'openaiChatCompletions'] as const)('lowers additional tools structurally for %s', async targetApi => {
  const input = invocation(targetApi, new Set());
  await withAdditionalToolsLowered(input, stubCtx, okEvents);
  assertEquals(input.payload.tools, [tool]);
  assertEquals(input.payload.input, [{ type: 'message', role: 'user', content: 'hi' }]);
});

test('preserves native Responses by default and lowers it when the flag is enabled', async () => {
  const disabled = invocation('openaiResponses', new Set());
  const enabled = invocation('openaiResponses', new Set(['openai-responses-additional-tools-shim']));

  await withAdditionalToolsLowered(disabled, stubCtx, okEvents);
  await withAdditionalToolsLowered(enabled, stubCtx, okEvents);

  assertEquals(disabled.payload.input[0]?.type, 'additional_tools');
  assertEquals(disabled.payload.tools, undefined);
  assertEquals(enabled.payload.input, [{ type: 'message', role: 'user', content: 'hi' }]);
  assertEquals(enabled.payload.tools, [tool]);
});
