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

test('lowers the first declaration to top-level tools and is idempotent', () => {
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

test('first mode accepts a declaration at its original position and merges existing top-level tools first', () => {
  const topLevel = { type: 'function' as const, name: 'existing', parameters: { type: 'object' } };
  assertEquals(lowerOpenAIResponsesAdditionalTools(payload({
    tools: [topLevel],
    input: [
      { type: 'message', role: 'user', content: 'hello' },
      { type: 'additional_tools', role: 'developer', tools },
    ],
  })), {
    model: 'gpt-test',
    tools: [topLevel, ...tools],
    input: [{ type: 'message', role: 'user', content: 'hello' }],
  });
});

test('first mode rejects a second declaration', () => {
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [
        { type: 'additional_tools', role: 'developer', tools },
        { type: 'additional_tools', role: 'developer', tools },
      ],
    })),
    Error,
    'more than one',
  );
});

test('all mode merges every declaration in input order and removes each item', () => {
  const existing = { type: 'function' as const, name: 'existing', parameters: { type: 'object' } };
  const later = { type: 'function' as const, name: 'later', parameters: { type: 'object' } };
  assertEquals(lowerOpenAIResponsesAdditionalTools(payload({
    tools: [existing],
    input: [
      { type: 'message', role: 'user', content: 'before' },
      { type: 'additional_tools', id: 'at_first', role: 'developer', tools },
      { type: 'message', role: 'user', content: 'between' },
      { type: 'additional_tools', id: 'at_second', role: 'developer', tools: [later] },
    ],
  }), 'all'), {
    model: 'gpt-test',
    tools: [existing, ...tools, later],
    input: [
      { type: 'message', role: 'user', content: 'before' },
      { type: 'message', role: 'user', content: 'between' },
    ],
  });
});

test('rejects a declaration with the wrong role in either lowering mode', () => {
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [{ type: 'additional_tools', role: 'user' as 'developer', tools }],
    })),
    Error,
    'developer role',
  );
  assertThrows(
    () => lowerOpenAIResponsesAdditionalTools(payload({
      input: [
        { type: 'additional_tools', role: 'developer', tools },
        { type: 'additional_tools', role: 'user' as 'developer', tools },
      ],
    }), 'all'),
    Error,
    'developer role',
  );
});
