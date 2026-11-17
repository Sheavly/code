import { describe, expect, it } from 'vitest';
import {
  ContributionCollisionError,
  ExtensionDefinitionError,
  ExtensionSettingError,
} from '../../errors/extension.errors.js';
import { defineSetting } from '../../extension/extension.utils.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ExtensionHost } from '../extension-host.service.js';

const signal = new AbortController().signal;
const LEVEL = defineSetting({ name: 'notes.level', description: 'How deep', default: 3 });
const TITLE = defineSetting({ name: 'notes.title', description: 'A title', default: 'none' });
const OTHER = defineSetting({ name: 'other.flag', description: 'A flag', default: false });

/** An extension that declares `settings` and records what `read` returns from its context. */
function notes(read?: (settings: { level: number; title: string }) => void) {
  return fakeExtension({
    name: 'notes',
    settings: [LEVEL, TITLE],
    activate: ({ settings }) => {
      read?.({ level: settings.get(LEVEL), title: settings.get(TITLE) });

      return {};
    },
  });
}

describe('defineSetting', () => {
  it('keeps the declaration, typed by its default', () => {
    expect(LEVEL).toEqual({ name: 'notes.level', description: 'How deep', default: 3 });
  });

  it.each(['level', 'Notes.level', 'notes.two words', 'a.b.c', 'notes.', '.level'])(
    'rejects the name %j',
    (name) => {
      expect(() => defineSetting({ name, description: 'x', default: 1 })).toThrow(
        ExtensionDefinitionError,
      );
    },
  );
});

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

  it('throws at construction when two extensions declare one setting name', () => {
    const rival = fakeExtension({ name: 'rival', settings: [LEVEL] });
    const caught = (() => {
      try {
        return new ExtensionHost({ extensions: [notes(), rival] });
      } catch (caughtError) {
        return caughtError;
      }
    })();

    expect(caught).toBeInstanceOf(ContributionCollisionError);
    expect((caught as ContributionCollisionError).contribution).toBe('setting');
    expect((caught as ContributionCollisionError).extensions).toEqual(['notes', 'rival']);
  });

  it('lists the settings of the extensions that activated, with the value in effect', async () => {
    const broken = fakeExtension({
      name: 'other',
      settings: [OTHER],
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
      { extension: 'notes', name: 'notes.level', description: 'How deep', default: 3, value: 3 },
      {
        extension: 'notes',
        name: 'notes.title',
        description: 'A title',
        default: 'none',
        value: 'Hi',
      },
    ]);
  });
});
