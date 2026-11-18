/** The size in bytes of a JSON value once serialized as UTF-8, as the stream and history store it. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** True when `name` is in `extension`'s namespace: it starts with `<extension>.`. */
export function isInNamespace(params: { extension: string; name: string }): boolean {
  return params.name.startsWith(`${params.extension}.`);
}
