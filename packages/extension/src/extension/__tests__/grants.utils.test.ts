import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '../../errors/manifest.errors.js';
import { requireGrant } from '../grants.utils.js';

describe('requireGrant', () => {
  it('passes for a grant the manifest lists', () => {
    expect(() =>
      requireGrant({
        extension: 'notes',
        grants: ['task:read', 'output:read'],
        grant: 'task:read',
      }),
    ).not.toThrow();
  });

  it.each([[['task:read']], [[]], [undefined]])(
    'throws an ExtensionUndeclaredError naming the extension and the grant, for grants %j',
    (grants) => {
      const call = () => requireGrant({ extension: 'notes', grants, grant: 'task:cancel-any' });

      expect(call).toThrow(ExtensionUndeclaredError);
      expect(call).toThrow(
        expect.objectContaining({
          extension: 'notes',
          use: 'grant',
          undeclared: 'task:cancel-any',
        }),
      );
      expect(call).toThrow(/Extension notes uses grant "task:cancel-any".*add it to grants/);
    },
  );

  it('matches exactly: a longer grant is not covered by its prefix', () => {
    expect(() =>
      requireGrant({ extension: 'notes', grants: ['task:read-any'], grant: 'task:read' }),
    ).toThrow(ExtensionUndeclaredError);
  });
});
