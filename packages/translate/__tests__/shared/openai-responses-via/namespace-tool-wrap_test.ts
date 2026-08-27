import { test } from 'vitest';

import { createNamespaceToolNames, namespaceTargetName, qualifiedNamespaceTargetName, registerNamespaceToolName } from '../../../src/shared/openai-responses-via/namespace-tool-wrap.ts';
import { assertEquals, assertThrows } from '@floway-dev/test-utils';

test('registerNamespaceToolName preserves structured source identity and allocates collision suffixes', () => {
  const names = createNamespaceToolNames();
  const reserved = new Set(['a_b_c']);

  assertEquals(registerNamespaceToolName(names, reserved, { namespace: 'a.b', name: 'c', kind: 'function' }), 'a_b_c_2');
  assertEquals(registerNamespaceToolName(names, reserved, { namespace: 'a', name: 'b.c', kind: 'custom' }), 'a_b_c_3');

  assertEquals(namespaceTargetName(names, 'a.b', 'c'), 'a_b_c_2');
  assertEquals(namespaceTargetName(names, 'a', 'b.c'), 'a_b_c_3');
  assertThrows(() => qualifiedNamespaceTargetName(names, 'a.b.c'), TypeError, "Ambiguous namespace tool choice 'a.b.c'.");
  assertEquals(names.targetToSource, new Map([
    ['a_b_c_2', { namespace: 'a.b', name: 'c', kind: 'function' }],
    ['a_b_c_3', { namespace: 'a', name: 'b.c', kind: 'custom' }],
  ]));
});
