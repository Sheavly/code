import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { assertSameDeletable } from '../files.helper.js';

const temp = useTempWorkspace({
  prefix: 'files-helper-test-',
  perTest: true,
  files: { 'a.txt': 'a\n', 'b.txt': 'b\n' },
});

describe('assertSameDeletable', () => {
  it('accepts the path it resolved', async () => {
    const real = await realpath(path.join(temp.root, 'a.txt'));

    await expect(
      assertSameDeletable({
        workspace: temp.workspace,
        requested: 'a.txt',
        expected: real,
        root: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses a path that now resolves somewhere else', async () => {
    const other = await realpath(path.join(temp.root, 'b.txt'));

    await expect(
      assertSameDeletable({
        workspace: temp.workspace,
        requested: 'a.txt',
        expected: other,
        root: undefined,
      }),
    ).rejects.toThrow('changed while the delete waited');
  });
});
