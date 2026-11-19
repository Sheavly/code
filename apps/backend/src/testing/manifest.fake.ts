import type { ExtensionManifest } from '@sheavly/extension/manifest/manifest.types';

/**
 * Test-only: an in-memory manifest for `defineExtension({ manifest, activate })`, the fields a
 * test leaves out empty like a `sheavly.json` that omits them. What `fields` list is what the
 * extension declares: the host holds it to exactly that.
 */
export function manifestOf(
  fields: Partial<Omit<ExtensionManifest, 'services' | 'emits'>> & {
    name: string;
    services?: Partial<ExtensionManifest['services']>;
    /** What it may emit: `{ events: ['notes.progress'], modelFacingNotices: true }`. */
    emits?: Partial<ExtensionManifest['emits']>;
  },
): ExtensionManifest {
  const { services = {}, emits = {}, ...rest } = fields;

  return {
    dependsOn: [],
    settings: [],
    tools: [],
    hooks: [],
    instructions: [],
    workKinds: [],
    serves: { actions: [] },
    ...rest,
    emits: { events: [], modelFacingNotices: false, ...emits },
    services: { requires: [], optional: [], provides: [], ...services },
  };
}
