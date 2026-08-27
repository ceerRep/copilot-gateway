import type { OpenAIResponsesTool } from '@floway-dev/protocols/openai-responses';

export interface NamespaceToolTarget {
  namespace: string;
  name: string;
  kind: 'function' | 'custom';
}

export interface NamespaceToolNames {
  sourceToTarget: Map<string, Map<string, string>>;
  targetToSource: Map<string, NamespaceToolTarget>;
}

export const createNamespaceToolNames = (): NamespaceToolNames => ({
  sourceToTarget: new Map(),
  targetToSource: new Map(),
});

export const reservedOpenAIResponsesToolNames = (tools: OpenAIResponsesTool[] | null | undefined): Set<string> =>
  new Set(
    (tools ?? []).flatMap(tool =>
      (tool.type === 'function' || tool.type === 'custom') && typeof tool.name === 'string'
        ? [tool.name]
        : []),
  );

export const registerNamespaceToolName = (
  names: NamespaceToolNames,
  reserved: Set<string>,
  source: NamespaceToolTarget,
): string => {
  const preferred = `${source.namespace}_${source.name}`.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
  let target = preferred;
  for (let suffix = 2; reserved.has(target); suffix++) target = `${preferred}_${suffix}`;
  reserved.add(target);

  const namespaceTools = names.sourceToTarget.get(source.namespace) ?? new Map<string, string>();
  namespaceTools.set(source.name, target);
  names.sourceToTarget.set(source.namespace, namespaceTools);
  names.targetToSource.set(target, source);
  return target;
};

export const namespaceTargetName = (
  names: NamespaceToolNames,
  namespace: string | undefined,
  name: string,
): string | undefined => namespace === undefined ? undefined : names.sourceToTarget.get(namespace)?.get(name);

export const qualifiedNamespaceTargetName = (names: NamespaceToolNames, qualifiedName: string): string | undefined => {
  let matched: string | undefined;
  for (const [namespace, tools] of names.sourceToTarget) {
    for (const [name, target] of tools) {
      if (`${namespace}.${name}` !== qualifiedName) continue;
      if (matched !== undefined) {
        throw new TypeError(`Ambiguous namespace tool choice '${qualifiedName}'.`);
      }
      matched = target;
    }
  }
  return matched;
};
