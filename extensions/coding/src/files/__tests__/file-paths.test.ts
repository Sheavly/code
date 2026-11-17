import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { useKeyedLocks } from '@sheavly/runtime/testing/keyed-locks.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { createWriteFileTool } from '../../write-file/write-file.tool.js';

const signal = new AbortController().signal;
const temp = useTempWorkspace({
  prefix: 'file-paths-test-',
  perTest: true,
  files: { 'app.ts': 'const a = 1;\n', 'dir/inner.ts': 'x\n' },
  outside: { 'outside.txt': 'outside\n' },
});
const fileLocks = useKeyedLocks();
const fileReads = useFileReads();

/** Runs a file tool as the agent does, on the test's workspace, locks and reads. */
const call = (name: 'read_file' | 'write_file' | 'edit_file', input: Record<string, unknown>) => {
  const shared = {
    workspace: temp.workspace,
    fileLocks: fileLocks.current,
    fileReads: fileReads.current,
  };

  return runTool({
    tools: [createReadFileTool(shared), createWriteFileTool(shared), createEditFileTool(shared)],
    call: { id: callIdSchema.parse('1'), name, input: { description: name, ...input } },
    signal,
  });
};

/** What is under the workspace, so a test can say nothing was made. */
const listing = async () => (await readdir(temp.root, { recursive: true })).sort();

describe('paths the file tools are given, however odd', () => {
  it.each(['', '.', './', 'dir', 'dir/', '../', '/', '//'])(
    'write_file refuses %j as a place to create a file, and makes nothing',
    async (requested) => {
      const before = await listing();
      const result = await call('write_file', { path: requested, content: 'x' });

      expect(result.isError, requested).toBe(true);
      expect(await listing()).toEqual(before);
    },
  );

  it.each(['', '.', 'dir', 'dir/'])(
    'edit_file and read_file refuse %j (a folder or the root), changing nothing',
    async (requested) => {
      const before = await listing();

      for (const name of ['read_file', 'edit_file'] as const) {
        const result = await call(name, { path: requested, oldText: 'x', newText: 'y' });

        expect(result.isError, `${name} ${requested}`).toBe(true);
      }

      expect(await listing()).toEqual(before);
    },
  );

  it.each([
    ['a NUL byte', 'app\u0000.ts'],
    ['a NUL before the extension', 'a.ts\u0000.png'],
  ])('refuses a path with %s, and creates nothing', async (_what, requested) => {
    const before = await listing();
    const result = await call('write_file', { path: requested, content: 'x' });

    expect(result.isError).toBe(true);
    expect(await listing()).toEqual(before);
  });

  it('refuses an absolute path to a file outside, and to the workspace’s parent', async () => {
    for (const requested of [
      path.join(temp.base, 'outside.txt'),
      temp.base,
      path.dirname(temp.base),
    ]) {
      expect((await call('write_file', { path: requested, content: 'x' })).isError, requested).toBe(
        true,
      );
    }

    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it('refuses a path that climbs out and comes back in only when it truly stays inside', async () => {
    const climbs = await call('write_file', { path: '../outside-new.txt', content: 'x' });
    const returns = await call('write_file', {
      path: `../${path.basename(temp.root)}/returned.ts`,
      content: 'x',
    });

    expect(climbs.isError).toBe(true);
    expect(existsSync(path.join(temp.base, 'outside-new.txt'))).toBe(false);
    // `../<workspace>/x` resolves to a file inside the workspace: fine.
    expect(returns.isError).toBe(false);
    expect(existsSync(path.join(temp.root, 'returned.ts'))).toBe(true);
  });

  it('refuses a new file under a symlinked folder that points outside, creating nothing there', async () => {
    await symlink(temp.base, path.join(temp.root, 'out'));

    const result = await call('write_file', { path: 'out/leaked.txt', content: 'x' });

    expect(result.isError).toBe(true);
    expect(existsSync(path.join(temp.base, 'leaked.txt'))).toBe(false);
  });

  it('does not follow a dangling symlink to create its target', async () => {
    await symlink(path.join(temp.base, 'not-yet.txt'), path.join(temp.root, 'dangling.txt'));

    const result = await call('write_file', { path: 'dangling.txt', content: 'x' });

    expect(result.isError).toBe(true);
    expect(existsSync(path.join(temp.base, 'not-yet.txt'))).toBe(false);
  });

  it('refuses very long names without partly creating the folders on the way', async () => {
    const before = await listing();
    const result = await call('write_file', {
      path: `deep/${'x'.repeat(5000)}/file.ts`,
      content: 'x',
    });

    expect(result.isError).toBe(true);
    expect(await listing()).toEqual(before);
  });

  it('treats names that only look special as ordinary files', async () => {
    await mkdir(path.join(temp.root, 'docs'));

    // `~` is no shortcut to the home folder: no shell reads it, so it is an ordinary name.
    for (const requested of ['..hidden', '...', 'a..b', '.env-notes.md', 'envrc', 'git', '~']) {
      expect((await call('write_file', { path: requested, content: 'x' })).isError, requested).toBe(
        false,
      );
    }
  });

  it('does not let a trailing dot or space reach a different file on case-folding systems', async () => {
    await writeFile(path.join(temp.root, 'Case.ts'), 'one\n');

    // Two spellings of one file on macOS/Windows; on Linux two files. Either way, creating the
    // second spelling must not overwrite the first.
    const result = await call('write_file', { path: 'case.ts', content: 'two\n' });

    expect(await readFile(path.join(temp.root, 'Case.ts'), 'utf8')).toBe('one\n');

    if (result.isError) expect(result.content).toContain('already exists');
  });
});
