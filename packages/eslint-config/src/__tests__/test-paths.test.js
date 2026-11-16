import { describe, expect, it } from 'vitest';
import { workspaceOfRelative } from '../layout.utils.js';
import { isTestOrFake } from '../test-paths.utils.js';

describe('isTestOrFake', () => {
  it.each([
    'src/__tests__/a.test.ts',
    'src/testing/echo.fake.ts',
    'testing/x.ts',
    'src/queue/queue.test.mjs',
    'src\\__tests__\\a.ts',
  ])('treats %s as a test or fake', (file) => {
    expect(isTestOrFake(file)).toBe(true);
  });

  it.each([
    'src/queue/queue.service.ts',
    'src/testing-tools/a.ts',
    'src/contest.ts',
    'src/provider/routed-provider.fake.ts',
    'a.prompt.ts',
  ])('treats %s as source', (file) => {
    expect(isTestOrFake(file)).toBe(false);
  });
});

describe('workspaceOfRelative', () => {
  const workspaces = [
    { name: 'root', relative: '.' },
    { name: '@sheavly/core', relative: 'packages/core' },
    { name: '@sheavly/nested', relative: 'packages/core/nested' },
  ];

  it('picks the deepest workspace holding the file', () => {
    expect(workspaceOfRelative({ workspaces, file: 'packages/core/nested/src/a.ts' })?.name).toBe(
      '@sheavly/nested',
    );
    expect(workspaceOfRelative({ workspaces, file: 'packages/core/src/a.ts' })?.name).toBe(
      '@sheavly/core',
    );
  });

  it('gives nothing for a file outside every workspace, the root included', () => {
    expect(workspaceOfRelative({ workspaces, file: 'scripts/x.mjs' })).toBeUndefined();
  });
});
