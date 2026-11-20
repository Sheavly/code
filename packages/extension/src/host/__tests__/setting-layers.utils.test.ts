import { describe, expect, it } from 'vitest';
import { ExtensionSettingError } from '../../errors/extension.errors.js';
import { fakeExtension, fakeSetting } from '../../testing/extension.fake.js';
import { layerSettings } from '../setting-layers.utils.js';
import type { SettingLayer, SettingSource } from '../setting-layers.types.js';

const SECRET = 'sk-live-0123456789abcdef';

/** `notes` declares a `project` setting, an unrestricted one, a restricted one and a `user` one. */
const NOTES = fakeExtension({
  name: 'notes',
  settings: [
    fakeSetting({ name: 'notes.level', default: 3, scope: 'project' }),
    fakeSetting({ name: 'notes.title', default: 'none', scope: 'project', restricted: true }),
    fakeSetting({ name: 'notes.loud', default: false }),
  ],
});

/** A layer holding `values`, labelled by the file it stands for. */
function layer(values: Record<string, string | number | boolean>, source = 'a.json'): SettingLayer {
  return { source, values };
}

describe('layerSettings precedence', () => {
  /** Each layer sets `notes.level` to its own number, so the value says whose it is. */
  const NUMBERS = { global: 1, profile: 2, workspace: 4 };

  /** The layers that set `notes.level`, then the value and layer that must win. */
  const CASES: [string[], number, SettingSource][] = [
    [[], 3, 'default'],
    [['workspace'], 4, 'workspace'],
    [['profile'], 2, 'profile'],
    [['profile', 'workspace'], 2, 'profile'],
    [['global'], 1, 'global'],
    [['global', 'workspace'], 1, 'global'],
    [['global', 'profile'], 1, 'global'],
    [['global', 'profile', 'workspace'], 1, 'global'],
  ];

  it.each(CASES)('when %j set it, the value is %s from %s', (sets, value, source) => {
    const given = (name: keyof typeof NUMBERS) =>
      sets.includes(name) ? layer({ 'notes.level': NUMBERS[name] }, `${name}.json`) : undefined;
    const layered = layerSettings({
      extensions: [NOTES],
      global: given('global'),
      profile: given('profile'),
      workspace: given('workspace'),
      workspaceTrusted: true,
    });

    expect(layered.sources['notes.level']).toBe(source);
    expect(layered.values['notes.level'] ?? 3).toBe(value);
    expect(Object.hasOwn(layered.values, 'notes.level')).toBe(source !== 'default');
    expect(layered.ignored).toEqual([]);
  });

  it('lists every declared setting in sources, at default when no layer sets it', () => {
    const layered = layerSettings({
      extensions: [NOTES],
      profile: layer({ 'notes.loud': true }),
      workspaceTrusted: false,
    });

    expect(layered.sources).toEqual({
      'notes.level': 'default',
      'notes.title': 'default',
      'notes.loud': 'profile',
    });
    expect(layered.values).toEqual({ 'notes.loud': true });
  });

  it('decides each setting on its own: one from each layer', () => {
    const layered = layerSettings({
      extensions: [NOTES],
      global: layer({ 'notes.loud': true }),
      profile: layer({ 'notes.title': 'P' }),
      workspace: layer({ 'notes.level': 8 }),
      workspaceTrusted: true,
    });

    expect(layered.values).toEqual({ 'notes.loud': true, 'notes.title': 'P', 'notes.level': 8 });
    expect(layered.sources).toEqual({
      'notes.loud': 'global',
      'notes.title': 'profile',
      'notes.level': 'workspace',
    });
  });

  it('works with no layers and no extensions', () => {
    expect(layerSettings({ extensions: [], workspaceTrusted: false })).toEqual({
      values: {},
      sources: {},
      ignored: [],
    });
  });
});

describe('layerSettings and the workspace layer', () => {
  /** What a workspace file setting `values` leads to, untrusted unless said. */
  function fromWorkspace(values: Record<string, string | number | boolean>, trusted = false) {
    return layerSettings({
      extensions: [NOTES],
      workspace: layer(values, 'project.json'),
      workspaceTrusted: trusted,
    });
  }

  it('ignores a value for a user setting, with the reason scope, even when trusted', () => {
    const layered = fromWorkspace({ 'notes.loud': true }, true);

    expect(layered.ignored).toEqual([{ name: 'notes.loud', layer: 'workspace', reason: 'scope' }]);
    expect(layered.values).toEqual({});
    expect(layered.sources['notes.loud']).toBe('default');
  });

  it('honours an unrestricted project setting even when the workspace is untrusted', () => {
    const layered = fromWorkspace({ 'notes.level': 9 });

    expect(layered.values).toEqual({ 'notes.level': 9 });
    expect(layered.ignored).toEqual([]);
  });

  it('ignores a restricted setting while untrusted, with the reason restricted', () => {
    const layered = fromWorkspace({ 'notes.title': 'T' });

    expect(layered.ignored).toEqual([
      { name: 'notes.title', layer: 'workspace', reason: 'restricted' },
    ]);
    expect(layered.values).toEqual({});
  });

  it('honours a restricted setting when the workspace is trusted', () => {
    const layered = fromWorkspace({ 'notes.title': 'T' }, true);

    expect(layered.values).toEqual({ 'notes.title': 'T' });
    expect(layered.sources['notes.title']).toBe('workspace');
    expect(layered.ignored).toEqual([]);
  });

  it('ignores an undeclared name and reports it, without failing', () => {
    const layered = fromWorkspace({ 'other.thing': 1, 'notes.level': 5 });

    expect(layered.ignored).toEqual([
      { name: 'other.thing', layer: 'workspace', reason: 'not-declared' },
    ]);
    expect(layered.values).toEqual({ 'notes.level': 5 });
  });

  it('ignores a value of the wrong type and reports it, without failing', () => {
    const layered = fromWorkspace({ 'notes.level': 'high' });

    expect(layered.ignored).toEqual([
      { name: 'notes.level', layer: 'workspace', reason: 'wrong-type' },
    ]);
    expect(layered.values).toEqual({});
  });

  it('reports ignored entries in the file’s order, each once', () => {
    const layered = fromWorkspace({ 'notes.loud': true, 'notes.title': 'T', 'x.y': 1 });

    expect(layered.ignored.map(({ name, reason }) => `${name}:${reason}`)).toEqual([
      'notes.loud:scope',
      'notes.title:restricted',
      'x.y:not-declared',
    ]);
  });

  it('lets a user layer’s value beat an accepted workspace one', () => {
    const layered = layerSettings({
      extensions: [NOTES],
      profile: layer({ 'notes.level': 2 }),
      workspace: layer({ 'notes.level': 9 }),
      workspaceTrusted: true,
    });

    expect(layered.values).toEqual({ 'notes.level': 2 });
  });

  it('never puts a value in an ignored entry', () => {
    const layered = fromWorkspace({
      'notes.loud': true,
      'notes.title': SECRET,
      'openai.api-key': SECRET,
      'notes.level': SECRET,
    });

    expect(layered.ignored).toHaveLength(4);
    expect(JSON.stringify(layered)).not.toContain(SECRET);
    layered.ignored.forEach((entry) => {
      expect(Object.keys(entry).toSorted()).toEqual(['layer', 'name', 'reason']);
    });
  });

  it('ignores prototype keys as undeclared, own keys only, and pollutes nothing', () => {
    const values = JSON.parse(
      '{"__proto__":1,"constructor":2,"prototype":3,"notes.level":4}',
    ) as Record<string, number>;
    const layered = fromWorkspace(values);

    expect(layered.ignored.map((entry) => entry.reason)).toEqual([
      'not-declared',
      'not-declared',
      'not-declared',
    ]);
    expect(layered.values).toEqual({ 'notes.level': 4 });
    expect(Object.hasOwn(layered.values, '__proto__')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'notes.level')).toBe(false);
  });
});

describe('layerSettings and the user layers', () => {
  it.each(['global', 'profile'] as const)(
    'throws naming the %s layer and its file for an undeclared name',
    (name) => {
      const run = () =>
        layerSettings({
          extensions: [NOTES],
          [name]: layer({ 'notes.levle': 1 }, `/home/u/${name}-settings.json`),
          workspaceTrusted: true,
        });

      expect(run).toThrow(ExtensionSettingError);
      expect(run).toThrow(new RegExp(`notes\\.levle.*the ${name} settings.*${name}-settings.json`));
      expect(run).toThrow(/typo/);
    },
  );

  it.each(['global', 'profile'] as const)(
    'throws naming the %s layer for a value of the wrong type, without the value',
    (name) => {
      const run = () =>
        layerSettings({
          extensions: [NOTES],
          [name]: layer({ 'notes.level': SECRET }, 'u.json'),
          workspaceTrusted: true,
        });

      expect(run).toThrow(new RegExp(`the ${name} settings \\(u.json\\)`));
      expect(run).toThrow(/declares it as a number, but the value is a string/);
      expect(run).not.toThrow(new RegExp(SECRET));
    },
  );

  it('lets the user layers set a user-scope and a restricted setting whatever the trust', () => {
    const layered = layerSettings({
      extensions: [NOTES],
      global: layer({ 'notes.loud': true }),
      profile: layer({ 'notes.title': 'P' }),
      workspaceTrusted: false,
    });

    expect(layered.values).toEqual({ 'notes.loud': true, 'notes.title': 'P' });
  });

  it('throws for a prototype key in a user layer', () => {
    const values = JSON.parse('{"__proto__":1}') as Record<string, number>;

    expect(() =>
      layerSettings({ extensions: [NOTES], global: layer(values), workspaceTrusted: true }),
    ).toThrow(ExtensionSettingError);
  });
});

describe('layerSettings results', () => {
  it('are frozen, down to each ignored entry', () => {
    const layered = layerSettings({
      extensions: [NOTES],
      workspace: layer({ 'notes.loud': true, 'notes.level': 5 }),
      workspaceTrusted: false,
    });

    expect(Object.isFrozen(layered.values)).toBe(true);
    expect(Object.isFrozen(layered.sources)).toBe(true);
    expect(Object.isFrozen(layered.ignored)).toBe(true);
    expect(layered.ignored.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it('do not change when the input layer is changed afterwards', () => {
    const values: Record<string, number> = { 'notes.level': 5 };
    const layered = layerSettings({
      extensions: [NOTES],
      workspace: layer(values),
      workspaceTrusted: false,
    });

    values['notes.level'] = 99;
    expect(layered.values).toEqual({ 'notes.level': 5 });
  });
});
