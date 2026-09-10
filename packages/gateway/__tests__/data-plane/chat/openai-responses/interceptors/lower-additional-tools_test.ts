import { expect, test } from 'vitest';

import { withAdditionalToolsLowered } from '../../../../../src/data-plane/chat/openai-responses/interceptors/lower-additional-tools.ts';
import type { OpenAIResponsesInvocation } from '../../../../../src/data-plane/chat/openai-responses/interceptors/types.ts';
import { mockChatGatewayCtx } from '../../../../test-utils/gateway-ctx.ts';
import type { ChatTargetApi, FlagId } from '@floway-dev/provider';
import { eventResult } from '@floway-dev/provider';
import { assertEquals, stubModelCandidate, testTelemetryModelIdentity } from '@floway-dev/test-utils';

const stubCtx = mockChatGatewayCtx();
const okEvents = () => Promise.resolve(eventResult((async function* () {})(), testTelemetryModelIdentity));
const tool = { type: 'function' as const, name: 'lookup', parameters: { type: 'object' } };
const laterTool = { type: 'function' as const, name: 'later', parameters: { type: 'object' } };

const invocation = (targetApi: ChatTargetApi, enabledFlags: ReadonlySet<FlagId>, multiple = false): OpenAIResponsesInvocation => ({
  payload: {
    model: 'm',
    input: [
      { type: 'additional_tools', role: 'developer', tools: [tool] },
      { type: 'message', role: 'user', content: 'hi' },
      ...(multiple ? [{ type: 'additional_tools' as const, role: 'developer' as const, tools: [laterTool] }] : []),
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

test('preserves every native Responses declaration by default', async () => {
  const disabled = invocation('openaiResponses', new Set(), true);

  await withAdditionalToolsLowered(disabled, stubCtx, okEvents);

  assertEquals(disabled.payload.input.map(item => item.type), ['additional_tools', 'message', 'additional_tools']);
  assertEquals(disabled.payload.tools, undefined);
});

test.each(['anthropicMessages', 'openaiChatCompletions'] as const)('rejects a second declaration for translated %s targets by default', async targetApi => {
  const input = invocation(targetApi, new Set(), true);
  await expect(withAdditionalToolsLowered(input, stubCtx, okEvents)).rejects.toThrow('more than one');
});

test.each(['openaiResponses', 'anthropicMessages', 'openaiChatCompletions'] as const)('merges every declaration for %s when the flag is enabled', async targetApi => {
  const enabled = invocation(targetApi, new Set(['openai-responses-additional-tools-shim']), true);
  await withAdditionalToolsLowered(enabled, stubCtx, okEvents);

  assertEquals(enabled.payload.input, [{ type: 'message', role: 'user', content: 'hi' }]);
  assertEquals(enabled.payload.tools, [tool, laterTool]);
});
