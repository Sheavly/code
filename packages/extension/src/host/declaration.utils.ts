import { ExtensionDefinitionError } from '../errors/extension.errors.js';
import { ExtensionUndeclaredError } from '../errors/manifest.errors.js';
import type { UndeclaredUse } from '../extension/extension.types.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';

/**
 * Whether a declared `entry` covers `name`: an exact match, or a prefix wildcard (`entry` ends in
 * `*`, which the manifest schema allows only there) that `name` starts with. A bare `*` covers
 * every name.
 */
function matchesDeclared(params: { entry: string; name: string }): boolean {
  const { entry, name } = params;

  if (!entry.endsWith('*')) return entry === name;

  return name.startsWith(entry.slice(0, -1));
}

/**
 * The notice topics a manifest declares: any in the extension's own namespace once
 * `emits.modelFacingNotices` is true, none otherwise. Topics are not listed one by one.
 */
export function declaredNoticeTopics(manifest: ExtensionManifest): readonly string[] {
  return manifest.emits.modelFacingNotices ? [`${manifest.name}.*`] : [];
}

/**
 * Throws an `ExtensionDefinitionError` when `manifest` declares grants for `service`: such a
 * service is built per consumer (`provideFor`), so a single shared value could not know whom to
 * check. Naming the extension, the service and the fix.
 */
export function assertNoSharedValueForGrants(params: {
  manifest: ExtensionManifest;
  service: string;
}): void {
  const { manifest, service } = params;

  if ((manifest.services.grants?.[service]?.length ?? 0) === 0) return;

  throw new ExtensionDefinitionError({
    extension: manifest.name,
    problem: `its sheavly.json declares grants for the service "${service}", so it must provide it with services.provideFor, which builds a value per consumer, not services.provide, whose one shared value cannot check who calls it`,
  });
}

/**
 * Throws an `ExtensionUndeclaredError` unless `name` is covered by one of the `allowed` entries
 * its manifest declares (see `matchesDeclared`). `declareIn` is the manifest field to add it to,
 * for the message.
 */
export function assertDeclared(params: {
  extension: string;
  use: UndeclaredUse;
  name: string;
  allowed: readonly string[];
  declareIn: string;
}): void {
  const { extension, use, name, allowed, declareIn } = params;

  if (allowed.some((entry) => matchesDeclared({ entry, name }))) return;

  throw new ExtensionUndeclaredError({ extension, use, undeclared: name, declareIn });
}
