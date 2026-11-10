/** Applies a Responses caching default without changing explicit choices or other adapters. */
export function withResponsesCacheDefault(params: {
  adapter: string;
  definition: Record<string, unknown>;
  enabled: boolean;
}): Record<string, unknown> {
  const { adapter, definition, enabled } = params;

  if (adapter !== 'openai' && adapter !== 'azure-openai') return definition;
  if (definition.explicitCache !== undefined) return definition;

  return { ...definition, explicitCache: enabled };
}
