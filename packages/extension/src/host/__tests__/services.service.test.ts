import { describe, expect, it } from 'vitest';
import { ContributionCollisionError, MissingServiceError } from '../../errors/extension.errors.js';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import { defineService, hostService } from '../../extension/extension.utils.js';
import type { ExtensionManifest } from '../../manifest/manifest.types.js';
import { fakeExtension } from '../../testing/extension.fake.js';
import { ServiceRegistry } from '../services.service.js';

const GREETING = defineService<string>('greeting');

type Declared = ExtensionManifest['services'];

/** A declaration that lists the greeting service as read and provided, unless `declared` says else. */
function viewOf(params: {
  registry: ServiceRegistry;
  extension: string;
  readable: string[];
  declared?: Declared;
}) {
  const { registry, extension, readable, declared } = params;
  const { requires, optional, provides } = declared ?? {
    requires: [GREETING.name],
    optional: [],
    provides: [GREETING.name],
  };

  return registry.viewFor({
    extension: fakeExtension({ name: extension, requires, optional, provides }),
    readable: new Set(readable),
  });
}

describe('ServiceRegistry', () => {
  it('gives a reader the service of an extension it may read', () => {
    const registry = new ServiceRegistry();

    viewOf({ registry, extension: 'a', readable: ['a'] }).provide(GREETING, 'hi');

    expect(viewOf({ registry, extension: 'b', readable: ['a', 'b'] }).get(GREETING)).toBe('hi');
  });

  it('refuses a second provider of one service, naming both', () => {
    const registry = new ServiceRegistry();

    viewOf({ registry, extension: 'a', readable: ['a'] }).provide(GREETING, 'hi');

    const second = viewOf({ registry, extension: 'b', readable: ['b'] });

    expect(() => second.provide(GREETING, 'yo')).toThrow(ContributionCollisionError);
    expect(() => second.provide(GREETING, 'yo')).toThrow(/both a and b/);
  });

  it('refuses a read of a service nobody provided', () => {
    const view = viewOf({ registry: new ServiceRegistry(), extension: 'a', readable: ['a'] });

    expect(() => view.get(GREETING)).toThrow(MissingServiceError);
  });

  it('lets every extension read a service the host supplies, with no dependency', () => {
    const registry = new ServiceRegistry([hostService({ key: GREETING, value: 'from host' })]);
    const view = viewOf({ registry, extension: 'b', readable: ['b'] });

    expect(view.get(GREETING)).toBe('from host');
    expect(view.find(GREETING)).toBe('from host');
    expect(registry.read(GREETING)).toBe('from host');
  });

  it('refuses an extension that provides a key the host supplies, naming the host', () => {
    const registry = new ServiceRegistry([hostService({ key: GREETING, value: 'from host' })]);
    const view = viewOf({ registry, extension: 'a', readable: ['a'] });

    expect(() => view.provide(GREETING, 'mine')).toThrow(ContributionCollisionError);
    expect(() => view.provide(GREETING, 'mine')).toThrow(/both the host and a/);
  });

  it('refuses two host services with one name', () => {
    expect(
      () =>
        new ServiceRegistry([
          hostService({ key: GREETING, value: 'one' }),
          hostService({ key: GREETING, value: 'two' }),
        ]),
    ).toThrow(ContributionCollisionError);
  });

  it('finds undefined when nobody provides the service, and the service when one does', () => {
    const registry = new ServiceRegistry();
    const view = viewOf({ registry, extension: 'a', readable: ['a'] });

    expect(view.find(GREETING)).toBeUndefined();

    view.provide(GREETING, 'hi');
    expect(view.find(GREETING)).toBe('hi');
  });

  it.each(['get', 'find'] as const)(
    'refuses a %s of a service from an extension the reader does not depend on',
    (read) => {
      const registry = new ServiceRegistry();

      viewOf({ registry, extension: 'a', readable: ['a'] }).provide(GREETING, 'hi');

      const reader = viewOf({ registry, extension: 'b', readable: ['b'] });

      expect(() => reader[read](GREETING)).toThrow(MissingServiceError);
      expect(() => reader[read](GREETING)).toThrow(/add it to dependsOn/);
    },
  );
});

describe('ServiceRegistry declarations', () => {
  const nothing: Declared = { requires: [], optional: [], provides: [] };
  const registry = () => new ServiceRegistry([hostService({ key: GREETING, value: 'hi' })]);

  it.each(['get', 'find'] as const)(
    'refuses a %s of a service the manifest lists neither as required nor optional',
    (read) => {
      const view = viewOf({
        registry: registry(),
        extension: 'a',
        readable: ['a'],
        declared: nothing,
      });

      expect(() => view[read](GREETING)).toThrow(ExtensionUndeclaredError);
      expect(() => view[read](GREETING)).toThrow(
        /Extension a uses service (get|find) "greeting", which its sheavly.json does not declare/,
      );
    },
  );

  it('lets find and get read what is listed as optional or required', () => {
    const view = viewOf({
      registry: registry(),
      extension: 'a',
      readable: ['a'],
      declared: { requires: [], optional: [GREETING.name], provides: [] },
    });

    expect(view.find(GREETING)).toBe('hi');
    expect(view.get(GREETING)).toBe('hi');
  });

  it('refuses to provide a service the manifest does not list in provides', () => {
    const view = viewOf({
      registry: new ServiceRegistry(),
      extension: 'a',
      readable: ['a'],
      declared: { requires: [GREETING.name], optional: [], provides: [] },
    });

    expect(() => view.provide(GREETING, 'mine')).toThrow(/uses service provide "greeting"/);
  });

  it('names the services a reader cannot read: nobody provided them, or a non-dependency did', () => {
    const shared = new ServiceRegistry();
    const other = defineService<string>('other');

    viewOf({ registry: shared, extension: 'a', readable: ['a'] }).provide(GREETING, 'hi');

    const reader = fakeExtension({ name: 'reader', requires: ['greeting', 'other'] });

    expect(
      shared.unreadable({
        extension: reader,
        required: ['greeting', 'other'],
        readable: new Set(['b']),
      }),
    ).toEqual(['greeting', 'other']);
    expect(
      shared.unreadable({
        extension: reader,
        required: ['greeting', other.name],
        readable: new Set(['a']),
      }),
    ).toEqual(['other']);
    expect(
      registry().unreadable({ extension: reader, required: ['greeting'], readable: new Set() }),
    ).toEqual([]);
  });
});
