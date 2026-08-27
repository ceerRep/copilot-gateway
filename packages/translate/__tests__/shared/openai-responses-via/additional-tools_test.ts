import { test } from 'vitest';

import { lowerOpenAIResponsesAdditionalTools } from '../../../src/shared/openai-responses-via/additional-tools.ts';
import type { CanonicalOpenAIResponsesPayload, OpenAIResponsesTool } from '@floway-dev/protocols/openai-responses';
import { assertEquals, assertThrows } from '@floway-dev/test-utils';

const tools: OpenAIResponsesTool[] = [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }];

const payload = (overrides: Partial<CanonicalOpenAIResponsesPayload> = {}): CanonicalOpenAIResponsesPayload => ({
  model: 'gpt-test',
  input: [
    { type: 'additional_tools', id: 'at_first', role: 'developer', tools },
    { type: 'message', role: 'user', content: 'hello' },
  ],
  ...overrides,
});

test('lowers the request-only declaration to top-level tools and is idempotent', () => {
  const lowered = lowerOpenAIResponsesAdditionalTools(payload());
  assertEquals(lowered, {
    model: 'gpt-test',
    input: [{ type: 'message', role: 'user', content: 'hello' }],
    tools,
  });
  assertEquals(lowerOpenAIResponsesAdditionalTools(lowered), lowered);
});

test('additional_tools ids do not affect the lowered request', () => {
  const first = lowerOpenAIResponsesAdditionalTools(payload());
  const second = lowerOpenAIResponsesAdditionalTools(payload({
    input: [
      { type: 'additional_tools', id: 'at_second', role: 'developer', tools },
      { type: 'message', role: 'user', content: 'hello' },
    ],
  }));
  assertEquals(first, second);
});

test('each request lowers only its current tool set', () => {
  const first = lowerOpenAIResponsesAdditionalTools(payload());
  const secondTools: OpenAIResponsesTool[] = [{ type: 'function', name: 'new_lookup', parameters: { type: 'object' } }];
  const second = lowerOpenAIResponsesAdditionalTools(payload({
    input: [{ type: 'additional_tools', role: 'developer', tools: secondTools }],
  }));
  assertEquals(first.tools, tools);
  assertEquals(second.tools, secondTools);
});

test('rejects misplaced, repeated, wrong-role, and conflicting declarations', () => {
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [
        { type: 'message', role: 'user', content: 'hello' },
        { type: 'additional_tools', role: 'developer', tools },
      ],
    })),
    Error,
    'sole declaration at input[0]',
  );
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [
        { type: 'additional_tools', role: 'developer', tools },
        { type: 'additional_tools', role: 'developer', tools },
      ],
    })),
    Error,
    'sole declaration at input[0]',
  );
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [{ type: 'additional_tools', role: 'user' as 'developer', tools }],
    })),
    Error,
    'developer role',
  );
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({ tools })),
    Error,
    'cannot be combined with non-empty top-level tools',
  );
});
