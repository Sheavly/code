import { describe, expect, it } from 'vitest';
import { ExtensionDefinitionError, ExtensionSettingError } from '../../errors/extension.errors.js';
import { settingKey } from '../../extension/extension.utils.js';
import { fakeExtension, fakeSetting } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';
import { layerSettings } from '../setting-layers.utils.js';

const signal = new AbortController().signal;
const LEVEL_DECLARED = fakeSetting({ name: 'notes.level', description: 'How deep', default: 3 });
const TITLE_DECLARED = fakeSetting({
  name: 'notes.title',
  description: 'A title',
  default: 'none',
});
const OTHER_DECLARED = fakeSetting({ name: 'other.flag', description: 'A flag', default: false });
const NOTES_MANIFEST = fakeExtension({
  name: 'notes',
  settings: [LEVEL_DECLARED, TITLE_DECLARED],
}).manifest;
const LEVEL = settingKey({ manifest: NOTES_MANIFEST, name: 'notes.level', type: 'number' });
const TITLE = settingKey({ manifest: NOTES_MANIFEST, name: 'notes.title', type: 'string' });

/** An extension that declares `settings` and records what `read` returns from its context. */
function notes(read?: (settings: { level: number; title: string }) => void) {
  return fakeExtension({
    name: 'notes',
    settings: [LEVEL_DECLARED, TITLE_DECLARED],
    activate: ({ settings }) => {
      read?.({ level: settings.get(LEVEL), title: settings.get(TITLE) });

      return {};
    },
  });
}

describe('ExtensionHost settings', () => {
  it('hands an extension the default when the user set none', async () => {
    let seen: unknown;

    await new ExtensionHost({ extensions: [notes((value) => (seen = value))] }).activate({
      signal,
    });
    expect(seen).toEqual({ level: 3, title: 'none' });
  });

  it('hands an extension the user’s value over the default', async () => {
    let seen: unknown;
    const host = new ExtensionHost({
      extensions: [notes((value) => (seen = value))],
      settings: { 'notes.level': 9 },
    });

    await host.activate({ signal });
    expect(seen).toEqual({ level: 9, title: 'none' });
  });

  it('fails an extension that reads a setting it did not declare', async () => {
    const host = new ExtensionHost({
      extensions: [
        fakeExtension({
          name: 'nosy',
          activate: ({ settings }) => {
            settings.get(LEVEL);

            return {};
          },
        }),
      ],
    });
    const result = await host.activate({ signal });

    expect(result.failed[0]?.cause).toBeInstanceOf(ExtensionSettingError);
    expect(result.failed[0]?.message).toContain('notes.level');
  });

  describe('a key built by hand', () => {
    /** The error or value of reading `key` from `reader`, which declares `notes.level` (default 3). */
    async function readWith(params: { key: unknown; settings?: Record<string, number> }) {
      let seen: unknown;
      let thrown: unknown;
      const host = new ExtensionHost({
        settings: params.settings,
        extensions: [
          fakeExtension({ name: 'other', settings: [OTHER_DECLARED] }),
          fakeExtension({
            name: 'notes',
            settings: [LEVEL_DECLARED],
            activate: ({ settings }) => {
              try {
                seen = settings.get(params.key as typeof LEVEL);
              } catch (caughtError) {
                thrown = caughtError;
                throw caughtError;
              }

              return {};
            },
          }),
        ],
      });

      await host.activate({ signal });

      return { seen, thrown };
    }

    it('cannot read the setting of another extension, whatever default it carries', async () => {
      const { seen, thrown } = await readWith({
        key: { name: 'other.flag', description: 'x', default: true },
      });

      expect(seen).toBeUndefined();
      expect(thrown).toBeInstanceOf(ExtensionSettingError);
      expect(String(thrown)).toContain('other.flag');
    });

    it('cannot read a setting nobody declared', async () => {
      const { thrown } = await readWith({ key: { name: 'notes.ghost', default: 1 } });

      expect(thrown).toBeInstanceOf(ExtensionSettingError);
    });

    it('reads the manifest’s default of a declared name, not the default the key carries', async () => {
      const { seen } = await readWith({ key: { name: 'notes.level', default: 99 } });

      expect(seen).toBe(3);
    });

    it('reads the user’s value of a declared name, whatever default the key carries', async () => {
      const { seen } = await readWith({
        key: { name: 'notes.level', default: 99 },
        settings: { 'notes.level': 7 },
      });

      expect(seen).toBe(7);
    });
  });

  it('throws at construction for a value no extension declares', () => {
    expect(
      () => new ExtensionHost({ extensions: [notes()], settings: { 'notes.levle': 1 } }),
    ).toThrow(ExtensionSettingError);
    expect(
      () => new ExtensionHost({ extensions: [notes()], settings: { 'notes.levle': 1 } }),
    ).toThrow(/typo/);
  });

  it('throws at construction for a value of another type than the default', () => {
    expect(
      () => new ExtensionHost({ extensions: [notes()], settings: { 'notes.level': 'high' } }),
    ).toThrow(/declares it as a number, but the value is a string/);
  });

  it('cannot have two extensions declare one setting name: a setting belongs to its extension', () => {
    expect(() => fakeExtension({ name: 'rival', settings: [LEVEL_DECLARED] })).toThrow(
      ExtensionDefinitionError,
    );
    expect(() => fakeExtension({ name: 'rival', settings: [LEVEL_DECLARED] })).toThrow(
      /must start with "rival\."/,
    );
  });

  it('lists the settings of the extensions that activated, with the value in effect', async () => {
    const broken = fakeExtension({
      name: 'other',
      settings: [OTHER_DECLARED],
      activate: () => {
        throw new Error('boom');
      },
    });
    const host = new ExtensionHost({
      extensions: [notes(), broken],
      settings: { 'notes.title': 'Hi', 'other.flag': true },
    });
    const { settings } = await host.activate({ signal });

    expect(settings).toEqual([
      {
        extension: 'notes',
        name: 'notes.level',
        description: 'How deep',
        default: 3,
        value: 3,
        source: 'default',
        scope: 'user',
        restricted: false,
      },
      {
        extension: 'notes',
        name: 'notes.title',
        description: 'A title',
        default: 'none',
        value: 'Hi',
        source: 'default',
        scope: 'user',
        restricted: false,
      },
    ]);
  });

  it('reports the layer in effect, the scope and restricted of each setting', async () => {
    const extension = fakeExtension({
      name: 'logs',
      settings: [
        fakeSetting({ name: 'logs.depth', default: 3, scope: 'project' }),
        fakeSetting({ name: 'logs.target', default: 'none', scope: 'project', restricted: true }),
        fakeSetting({ name: 'logs.color', default: false }),
      ],
    });
    const layered = layerSettings({
      extensions: [extension],
      global: { source: 'g.json', values: { 'logs.color': true } },
      workspace: { source: 'w.json', values: { 'logs.depth': 7 } },
      workspaceTrusted: false,
    });
    const host = new ExtensionHost({
      extensions: [extension],
      settings: layered.values,
      settingSources: layered.sources,
    });
    const { settings } = await host.activate({ signal });

    expect(
      settings.map(({ name, value, source, scope, restricted }) => ({
        name,
        value,
        source,
        scope,
        restricted,
      })),
    ).toEqual([
      { name: 'logs.depth', value: 7, source: 'workspace', scope: 'project', restricted: false },
      { name: 'logs.target', value: 'none', source: 'default', scope: 'project', restricted: true },
      { name: 'logs.color', value: true, source: 'global', scope: 'user', restricted: false },
    ]);
  });

  it('reads a source only for the names it lists, from own keys', async () => {
    const sources = JSON.parse('{"__proto__":"global"}') as Record<string, 'global'>;
    const host = new ExtensionHost({ extensions: [notes()], settingSources: sources });
    const { settings } = await host.activate({ signal });

    expect(settings.map((info) => info.source)).toEqual(['default', 'default']);
  });
});
