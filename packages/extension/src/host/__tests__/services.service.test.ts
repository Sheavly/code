import { describe, expect, it } from 'vitest';
import { ContributionCollisionError, MissingServiceError } from '../../errors/extension.errors.js';
import { defineService, hostService } from '../../extension/extension.utils.js';
import { ServiceRegistry } from '../services.service.js';

const GREETING = defineService<string>('greeting');

describe('ServiceRegistry', () => {
  it('gives a reader the service of an extension it may read', () => {
    const registry = new ServiceRegistry();

    registry.viewFor({ extension: 'a', readable: new Set(['a']) }).provide(GREETING, 'hi');

    expect(registry.viewFor({ extension: 'b', readable: new Set(['a', 'b']) }).get(GREETING)).toBe(
      'hi',
    );
  });

  it('refuses a second provider of one service, naming both', () => {
    const registry = new ServiceRegistry();

    registry.viewFor({ extension: 'a', readable: new Set(['a']) }).provide(GREETING, 'hi');

    const second = registry.viewFor({ extension: 'b', readable: new Set(['b']) });

    expect(() => second.provide(GREETING, 'yo')).toThrow(ContributionCollisionError);
    expect(() => second.provide(GREETING, 'yo')).toThrow(/both a and b/);
  });

  it('refuses a read of a service nobody provided', () => {
    const view = new ServiceRegistry().viewFor({ extension: 'a', readable: new Set(['a']) });

    expect(() => view.get(GREETING)).toThrow(MissingServiceError);
  });

  it('lets every extension read a service the host supplies, with no dependency', () => {
    const registry = new ServiceRegistry([hostService({ key: GREETING, value: 'from host' })]);
    const view = registry.viewFor({ extension: 'b', readable: new Set(['b']) });

    expect(view.get(GREETING)).toBe('from host');
    expect(view.find(GREETING)).toBe('from host');
    expect(registry.read(GREETING)).toBe('from host');
  });

  it('refuses an extension that provides a key the host supplies, naming the host', () => {
    const registry = new ServiceRegistry([hostService({ key: GREETING, value: 'from host' })]);
    const view = registry.viewFor({ extension: 'a', readable: new Set(['a']) });

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
    const view = registry.viewFor({ extension: 'a', readable: new Set(['a']) });

    expect(view.find(GREETING)).toBeUndefined();

    view.provide(GREETING, 'hi');
    expect(view.find(GREETING)).toBe('hi');
  });

  it.each(['get', 'find'] as const)(
    'refuses a %s of a service from an extension the reader does not depend on',
    (read) => {
      const registry = new ServiceRegistry();

      registry.viewFor({ extension: 'a', readable: new Set(['a']) }).provide(GREETING, 'hi');

      const reader = registry.viewFor({ extension: 'b', readable: new Set(['b']) });

      expect(() => reader[read](GREETING)).toThrow(MissingServiceError);
      expect(() => reader[read](GREETING)).toThrow(/add it to dependsOn/);
    },
  );
});
