import type { ExtensionManifest } from '@sheavly/extension/manifest/manifest.types';

/**
 * Test-only: an in-memory manifest for `defineExtension({ manifest, activate })`, the fields a
 * test leaves out empty like a `sheavly.json` that omits them. What `fields` list is what the
 * extension declares: the host holds it to exactly that.
 */
export function manifestOf(
  fields: Partial<Omit<ExtensionManifest, 'services'>> & {
    name: string;
    services?: Partial<ExtensionManifest['services']>;
  },
): ExtensionManifest {
  const { services = {}, ...rest } = fields;

  return {
    dependsOn: [],
    settings: [],
    tools: [],
    hooks: [],
    workKinds: [],
    emits: { events: [], modelFacingNotices: false },
    serves: { actions: [] },
    ...rest,
    services: { requires: [], optional: [], provides: [], ...services },
  };
}
