import { test } from 'vitest';

import { withRoleCompatibilityApplied } from '../../../../../src/data-plane/chat/anthropic-messages/interceptors/apply-role-compatibility.ts';
import type { AnthropicMessagesInvocation } from '../../../../../src/data-plane/chat/anthropic-messages/interceptors/types.ts';
import { mockChatGatewayCtx } from '../../../../test-utils/gateway-ctx.ts';
import type { AnthropicMessagesMessage, AnthropicMessagesPayload, AnthropicMessagesStreamEvent } from '@floway-dev/protocols/anthropic-messages';
import type { ProtocolFrame } from '@floway-dev/protocols/common';
import { type ExecuteResult, eventResult, type FlagId } from '@floway-dev/provider';
import { assert, assertEquals, stubModelCandidate, testTelemetryModelIdentity } from '@floway-dev/test-utils';

const gatewayCtx = mockChatGatewayCtx();
const okEvents = (): Promise<ExecuteResult<ProtocolFrame<AnthropicMessagesStreamEvent>>> =>
  Promise.resolve(eventResult((async function* (): AsyncGenerator<ProtocolFrame<AnthropicMessagesStreamEvent>> {})(), testTelemetryModelIdentity));

const applyRoles = async (
  messages: AnthropicMessagesMessage[],
  enabledFlags: ReadonlySet<FlagId>,
  targetApi: AnthropicMessagesInvocation['targetApi'] = 'anthropicMessages',
): Promise<AnthropicMessagesMessage[]> => {
  const payload: AnthropicMessagesPayload = { model: 'test-model', max_tokens: 1, messages };
  const invocation: AnthropicMessagesInvocation = {
    payload,
    candidate: stubModelCandidate({ enabledFlags }),
    targetApi,
    headers: new Headers(),
  };
  await withRoleCompatibilityApplied(invocation, gatewayCtx, okEvents);
  return invocation.payload.messages;
};

test('force-rewrites every inline system message when the compatibility flag is enabled', async () => {
  const messages: AnthropicMessagesMessage[] = [
    { role: 'system', content: 'initial inline rules' },
    { role: 'user', content: 'first request' },
    { role: 'system', content: 'legal inline rules' },
  ];
  assertEquals(await applyRoles(messages, new Set(['rewrite-mid-conv-system-to-user'])), [
    { role: 'user', content: 'initial inline rules' },
    { role: 'user', content: 'first request' },
    { role: 'user', content: 'legal inline rules' },
  ]);
  assertEquals(
    await applyRoles(messages, new Set(['rewrite-mid-conv-system-to-user']), 'openaiResponses'),
    messages,
  );
});

test('preserves expressible inline system messages when the compatibility flag is disabled', async () => {
  const messages: AnthropicMessagesMessage[] = [
    { role: 'user', content: 'first request' },
    { role: 'system', content: 'rules for recorded reply' },
    { role: 'assistant', content: 'first reply' },
    { role: 'user', content: 'second request' },
    { role: 'system', content: 'rules for generated reply' },
  ];
  assertEquals(await applyRoles(messages, new Set()), messages);
});

test('lowers inline system messages whose position cannot be expressed', async () => {
  assertEquals(
    await applyRoles(
      [
        { role: 'system', content: 'leading rules' },
        { role: 'user', content: 'first request' },
        { role: 'system', content: 'rules followed by user' },
        { role: 'user', content: 'second request' },
        { role: 'assistant', content: 'reply' },
        { role: 'system', content: 'rules following assistant' },
        { role: 'assistant', content: 'another reply' },
      ],
      new Set(),
    ),
    [
      { role: 'user', content: 'leading rules' },
      { role: 'user', content: 'first request' },
      { role: 'user', content: 'rules followed by user' },
      { role: 'user', content: 'second request' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'rules following assistant' },
      { role: 'assistant', content: 'another reply' },
    ],
  );
});

test('judges consecutive inline system messages against the original sequence', async () => {
  assertEquals(
    await applyRoles(
      [
        { role: 'user', content: 'request' },
        { role: 'system', content: 'first rules' },
        { role: 'system', content: 'second rules' },
        { role: 'assistant', content: 'reply' },
      ],
      new Set(),
    ),
    [
      { role: 'user', content: 'request' },
      { role: 'user', content: 'first rules' },
      { role: 'user', content: 'second rules' },
      { role: 'assistant', content: 'reply' },
    ],
  );
});

test('preserves inline content identity while lowering its role', async () => {
  const content = [{ type: 'text' as const, text: 'inline rules' }];
  const result = await applyRoles([{ role: 'system', content }], new Set());
  assert(result[0]?.content === content);
});

test('handles empty input and leaves non-system messages unchanged', async () => {
  assertEquals(await applyRoles([], new Set()), []);
  const messages: AnthropicMessagesMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ];
  assertEquals(await applyRoles(messages, new Set()), messages);
});
