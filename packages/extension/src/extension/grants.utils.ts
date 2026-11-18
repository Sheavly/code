import { ExtensionUndeclaredError } from '../errors/manifest.errors.js';

/**
 * Throws an `ExtensionUndeclaredError` (`use: 'grant'`) naming the extension and `grant` unless
 * `grants` lists it. The one check every per-extension service method makes: a factory reads
 * `manifest.grants` once from the `{ name, manifest }` it receives and passes it here on each
 * call, so no service keeps its own copy of the check. A manifest without `grants` holds none.
 */
export function requireGrant(params: {
  extension: string;
  grants: readonly string[] | undefined;
  grant: string;
}): void {
  const { extension, grants = [], grant } = params;

  if (grants.includes(grant)) return;

  throw new ExtensionUndeclaredError({
    extension,
    use: 'grant',
    undeclared: grant,
    declareIn: 'grants',
  });
}
