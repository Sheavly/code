import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { removeFile } from '../file-effects.helper.js';

const temp = useTempWorkspace({
  prefix: 'file-effects-test-',
  perTest: true,
  files: { 'a.txt': 'a\n' },
});
const file = () => path.join(temp.root, 'a.txt');

describe('removeFile', () => {
  it('removes the file when the call is still running', async () => {
    await removeFile({ file: file(), signal: new AbortController().signal });

    expect(existsSync(file())).toBe(false);
  });

  it('leaves the file when the call was aborted before the unlink', async () => {
    const controller = new AbortController();

    controller.abort();

    await expect(removeFile({ file: file(), signal: controller.signal })).rejects.toThrow();
    expect(existsSync(file())).toBe(true);
  });
});
