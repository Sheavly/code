/**
 * An explicit limit wins; otherwise the table's limit for `key`, if it lists one. The tables
 * themselves belong to each protocol, since vendors change their model lists independently.
 */
export function outputTokenLimit(params: {
  key: string;
  maxTokens: number | undefined;
  defaults: Readonly<Record<string, number>>;
}): number | undefined {
  if (params.maxTokens !== undefined) return params.maxTokens;

  return Object.hasOwn(params.defaults, params.key) ? params.defaults[params.key] : undefined;
}
