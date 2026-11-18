import { describe, expect, it } from 'vitest';
import { extensionManifestSchema } from '../manifest.validator.js';

/** The path and message of every problem zod finds in `input`. */
function problems(input: unknown): { path: string; message: string }[] {
  const parsed = extensionManifestSchema.safeParse(input);

  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('the manifest grants field', () => {
  it('is optional and absent from a manifest that declares none', () => {
    expect(extensionManifestSchema.parse({ name: 'notes' })).not.toHaveProperty('grants');
  });

  it.each([['sub-agent:create'], ['task:cancel-any'], ['output:read'], ['model:call']])(
    'accepts the grant %s',
    (grant) => {
      expect(extensionManifestSchema.parse({ name: 'notes', grants: [grant] }).grants).toEqual([
        grant,
      ]);
    },
  );

  it.each([
    'task',
    'task:',
    ':read',
    'Task:read',
    'task:Read',
    'task:read:any',
    'task read',
    '1task:read',
    'task:-read',
    'task:read-',
    'task--x:read',
    '',
  ])('rejects the grant %j, naming the path', (grant) => {
    const found = problems({ name: 'notes', grants: [grant] });

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('grants.0');
    expect(found[0]?.message).toContain('<noun>:<verb>');
  });

  it('rejects a grant listed twice, at the repeat', () => {
    expect(problems({ name: 'notes', grants: ['task:read', 'output:read', 'task:read'] })).toEqual([
      { path: 'grants.2', message: '"task:read" is listed twice' },
    ]);
  });

  it('rejects a grants value that is no list, and an unknown key beside it', () => {
    expect(problems({ name: 'notes', grants: 'task:read' }).map(({ path }) => path)).toEqual([
      'grants',
    ]);
    expect(problems({ name: 'notes', grant: ['task:read'] })[0]?.message).toMatch(
      /Unrecognized key/,
    );
  });
});
