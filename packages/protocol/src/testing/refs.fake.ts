/** Test-only: every `$ref` in a JSON Schema or OpenAPI document, however deep. */
export function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, field]) =>
    key === '$ref' && typeof field === 'string' ? [field] : refsIn(field),
  );
}
