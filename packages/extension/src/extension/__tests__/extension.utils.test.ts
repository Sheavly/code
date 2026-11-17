import { describe, expect, it } from 'vitest';
import { ExtensionDefinitionError } from '../../errors/extension.errors.js';
import type { ExtensionManifest } from '../../manifest/manifest.types.js';
import { fakeExtension, fakeSetting } from '../../testing/extension.fake.js';
import { defineExtension, defineService, settingKey } from '../extension.utils.js';

/** The manifest of a bare extension called `notes`, with `fields` laid over it. */
const manifestOf = (fields: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  ...fakeExtension({ name: 'notes' }).manifest,
  ...fields,
});

describe('defineExtension', () => {
  it('derives the name, dependsOn and settings from the manifest', () => {
    const manifest = manifestOf({
      dependsOn: ['files'],
      settings: [fakeSetting({ name: 'notes.level', description: 'How deep', default: 3 })],
    });
    const extension = defineExtension({ manifest, activate: () => ({}) });

    expect(extension.manifest).toEqual(manifest);
    expect(extension.name).toBe('notes');
    expect(extension.dependsOn).toEqual(['files']);
    expect(extension.settings).toEqual([
      { name: 'notes.level', description: 'How deep', default: 3 },
    ]);
  });

  it('keeps the origin and the code it was given', () => {
    const activate = () => ({});
    const deactivate = () => undefined;
    const extension = defineExtension({
      manifest: manifestOf(),
      origin: 'project',
      activate,
      deactivate,
    });

    expect(extension.origin).toBe('project');
    expect(extension.activate).toBe(activate);
    expect(extension.deactivate).toBe(deactivate);
  });

  it.each(['Notes', 'two words', 'under_score', '', '-lead'])('rejects the name %j', (name) => {
    expect(() => defineExtension({ manifest: manifestOf({ name }), activate: () => ({}) })).toThrow(
      ExtensionDefinitionError,
    );
  });

  it('rejects a dependency on itself', () => {
    const manifest = manifestOf({ dependsOn: ['notes'] });

    expect(() => defineExtension({ manifest, activate: () => ({}) })).toThrow(
      /cannot depend on itself/,
    );
  });

  it.each([
    ['null', null],
    ['a string', 'notes'],
    ['a number', 7],
    ['an array', []],
  ])(
    'throws an ExtensionDefinitionError, not a TypeError, for %s as the manifest',
    (_what, manifest) => {
      const define = () => defineExtension({ manifest: manifest as never, activate: () => ({}) });

      expect(define).toThrow(ExtensionDefinitionError);
      expect(define).toThrow(/Extension <unnamed>: its manifest is invalid/);
    },
  );

  it('names the extension in the error when the manifest is an object with a name', () => {
    const manifest: unknown = { name: 'notes', tools: 'x' };
    const define = () => defineExtension({ manifest: manifest as never, activate: () => ({}) });

    expect(define).toThrow(/Extension notes: its manifest is invalid/);
  });

  it('rejects the same dependency twice', () => {
    const manifest = manifestOf({ dependsOn: ['files', 'files'] });

    expect(() => defineExtension({ manifest, activate: () => ({}) })).toThrow(/listed twice/);
  });
});

describe('defineService', () => {
  it('keys a service by its name', () => {
    expect(defineService<number>('counter')).toEqual({ name: 'counter' });
  });
});

describe('settingKey', () => {
  const manifest = manifestOf({
    settings: [
      fakeSetting({ name: 'notes.level', description: 'How deep', default: 3 }),
      fakeSetting({ name: 'notes.title', description: 'A title', default: 'none' }),
      fakeSetting({ name: 'notes.loud', description: 'Shout', default: false }),
    ],
  });

  it('takes the name, default and description from the manifest', () => {
    expect(settingKey({ manifest, name: 'notes.level', type: 'number' })).toEqual({
      name: 'notes.level',
      description: 'How deep',
      default: 3,
    });
  });

  it('types the key by the tag: a number, a string or a boolean', () => {
    const level: number = settingKey({ manifest, name: 'notes.level', type: 'number' }).default;
    const title: string = settingKey({ manifest, name: 'notes.title', type: 'string' }).default;
    const loud: boolean = settingKey({ manifest, name: 'notes.loud', type: 'boolean' }).default;

    expect([level, title, loud]).toEqual([3, 'none', false]);
  });

  it('throws when the manifest does not declare the setting', () => {
    expect(() => settingKey({ manifest, name: 'notes.missing', type: 'number' })).toThrow(
      ExtensionDefinitionError,
    );
    expect(() => settingKey({ manifest, name: 'notes.missing', type: 'number' })).toThrow(
      /does not declare the setting "notes.missing"/,
    );
  });

  it('throws when the tag is not the declared type', () => {
    expect(() => settingKey({ manifest, name: 'notes.level', type: 'string' })).toThrow(
      /declares the setting "notes.level" as a number, not a string/,
    );
  });
});
