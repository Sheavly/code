/** The error's message, or the thrown value as text when it isn't an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The error's system code (`ENOENT`, `EACCES`, ...), if it has one. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' ? code : undefined;
}

/**
 * True when a path simply isn't there: it, or a folder on the way to it, doesn't exist
 * (`ENOENT`, `ENOTDIR`). Anything else (`EACCES`, `ELOOP`, `EIO`) is a failure to check the
 * path, never proof that it is missing.
 */
export function isMissingPath(error: unknown): boolean {
  const code = errorCode(error);

  return code === 'ENOENT' || code === 'ENOTDIR';
}
