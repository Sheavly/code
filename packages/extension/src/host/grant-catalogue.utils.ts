import { ExtensionGrantError } from '../errors/manifest.errors.js';
import { HOST_PROVIDER } from '../extension/extension.constants.js';
import type { HostService } from '../extension/extension.types.js';
import { HOST_OFFERED_GRANTS } from '../instructions/instructions.constants.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';
import type { GrantCatalogue } from './extension-host.types.js';

/**
 * The grants the supplied services understand, plus the ones the host offers itself
 * (`HOST_OFFERED_GRANTS`, listed under `HOST_PROVIDER`). Only factory services declare grants; a
 * plain value declares none, so a grant that only a value could "own" is unknown.
 */
export function grantCatalogueOf(services: readonly HostService[]): GrantCatalogue {
  const catalogue = new Map<string, string[]>(
    HOST_OFFERED_GRANTS.map((grant) => [grant, [HOST_PROVIDER]]),
  );

  for (const service of services) {
    if (!('grants' in service)) continue;

    for (const grant of service.grants) {
      catalogue.set(grant, [...(catalogue.get(grant) ?? []), service.name]);
    }
  }

  return catalogue;
}

/**
 * Throws an `ExtensionGrantError` for the first grant in `manifest.grants` that no service of
 * `catalogue` offers, or whose services the extension does not list in `services.requires` or
 * `optional`. Run before `activate`, so a typo or a grant without its service fails loudly.
 */
export function assertGrantsOffered(params: {
  manifest: ExtensionManifest;
  catalogue: GrantCatalogue;
}): void {
  const { manifest, catalogue } = params;
  const readable = [...manifest.services.requires, ...manifest.services.optional];

  for (const grant of manifest.grants ?? []) {
    const offeredBy = catalogue.get(grant);

    if (offeredBy === undefined) {
      throw new ExtensionGrantError({
        extension: manifest.name,
        grant,
        problem: 'no service the host supplies offers it (a typo?)',
      });
    }

    // The host's own grants need no service, so there is nothing for the extension to list.
    if (offeredBy.includes(HOST_PROVIDER)) continue;

    if (offeredBy.some((service) => readable.includes(service))) continue;

    throw new ExtensionGrantError({
      extension: manifest.name,
      grant,
      problem: `it belongs to the service ${offeredBy.map((name) => `"${name}"`).join(' or ')}, which the extension does not list in services.requires or services.optional`,
    });
  }
}
