import { describe, expect, it } from 'vitest';
import { ExtensionDefinitionError } from '../../errors/extension.errors.js';
import type { Extension } from '../extension.types.js';
import { defineExtension, defineService } from '../extension.utils.js';

const extension = (fields: Partial<Extension> = {}): Extension => ({
  name: 'notes',
  activate: () => ({}),
  ...fields,
});

describe('defineExtension', () => {
  it('returns a valid extension as it is', () => {
    const value = extension({ dependsOn: ['files'] });

    expect(defineExtension(value)).toBe(value);
  });

  it.each(['Notes', 'two words', 'under_score', '', '-lead'])('rejects the name %j', (name) => {
    expect(() => defineExtension(extension({ name }))).toThrow(ExtensionDefinitionError);
  });

  it('rejects a dependency on itself', () => {
    expect(() => defineExtension(extension({ dependsOn: ['notes'] }))).toThrow(/depend on itself/);
  });

  it('rejects the same dependency twice', () => {
    expect(() => defineExtension(extension({ dependsOn: ['files', 'files'] }))).toThrow(/twice/);
  });
});

describe('defineService', () => {
  it('keys a service by its name', () => {
    expect(defineService<number>('counter')).toEqual({ name: 'counter' });
  });
});
