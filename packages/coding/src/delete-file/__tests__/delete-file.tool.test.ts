import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createWriteFileTool } from '../../write-file/write-file.tool.js';
import { isFileChange } from '../../files/files.utils.js';
import { createDeleteFileTool } from '../delete-file.tool.js';

const signal = new AbortController().signal;
const temp = useTempWorkspace({
  prefix: 'delete-file-test-',
  perTest: true,
  files: { 'existing.ts': 'old\ntext\n', 'dir/inner.ts': 'x\n' },
  outside: { 'outside.txt': 'outside\n' },
});
const fileLocks = useFileLocks();
const fileReads = useFileReads();
/** The services `createHarness` wires together, as the backend gives them to every file tool. */
const shared = () => ({
  workspace: temp.workspace,
  fileLocks: fileLocks.current,
  fileReads: fileReads.current,
});

const call = (
  name: string,
  input: Record<string, unknown>,
  tools = [createDeleteFileTool(shared())],
) =>
  runTool({
    tools,
    call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
    signal,
  });
const remove = (filePath: string) => call('delete_file', { path: filePath });

describe('delete_file', () => {
  it('deletes a file, and reports the content it held with after: null', async () => {
    const result = await remove('existing.ts');

    expect(result).toMatchObject({ isError: false, content: 'Deleted existing.ts (3 → 0 lines)' });
    expect(result.artifacts).toEqual([
      { kind: 'file_change', path: 'existing.ts', before: 'old\ntext\n', after: null },
    ]);
    expect(existsSync(path.join(temp.root, 'existing.ts'))).toBe(false);
  });

  it('deletes a file the agent created, reporting what was there', async () => {
    await call('write_file', { path: 'fresh/a.ts', content: 'const a = 1;\n' }, [
      createWriteFileTool(shared()),
    ]);

    const result = await remove('fresh/a.ts');

    expect((result.artifacts?.find(isFileChange) as { before: string }).before).toBe(
      'const a = 1;\n',
    );
    expect(existsSync(path.join(temp.root, 'fresh/a.ts'))).toBe(false);
  });

  it('refuses a folder, and deletes nothing in it', async () => {
    const result = await remove('dir');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('not a regular file');
    expect(result.artifacts).toBeUndefined();
    expect(await readFile(path.join(temp.root, 'dir/inner.ts'), 'utf8')).toBe('x\n');
    expect((await remove('.')).content).toContain('not a regular file');
  });

  it('refuses a file that is not there, instead of reporting a delete', async () => {
    const result = await remove('gone.ts');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('File not found: gone.ts');
    expect(result.artifacts).toBeUndefined();
  });

  it('refuses paths outside the workspace, and leaves the file there', async () => {
    const result = await remove('../outside.txt');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Path is outside the workspace');
    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it('refuses a symlink, whether it points inside or out, and removes neither target', async () => {
    await symlink(path.join(temp.root, 'existing.ts'), path.join(temp.root, 'alias.ts'));
    await symlink(path.join(temp.base, 'outside.txt'), path.join(temp.root, 'link-out.txt'));

    for (const link of ['alias.ts', 'link-out.txt']) {
      const result = await remove(link);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Refusing to delete a symlink');
    }

    expect(await readFile(path.join(temp.root, 'existing.ts'), 'utf8')).toBe('old\ntext\n');
    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
    expect(existsSync(path.join(temp.root, 'alias.ts'))).toBe(true);
  });

  it.each(['.env', '.env.local', 'nested/.env.production'])(
    'refuses to delete %s',
    async (file) => {
      const result = await remove(file);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Deleting .env files is not allowed');
    },
  );

  it('refuses paths inside .git, and deletes nothing there', async () => {
    await mkdir(path.join(temp.root, '.git'));
    await writeFile(path.join(temp.root, '.git', 'config'), '[core]\n');

    for (const file of ['.git/config', '.Git/config']) {
      const result = await remove(file);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Deleting inside .git is not allowed');
    }

    expect(existsSync(path.join(temp.root, '.git/config'))).toBe(true);
  });

  it('forgets the deleted file, so an edit after a new file takes its place is not from memory', async () => {
    const file = await realpath(path.join(temp.root, 'existing.ts'));

    fileReads.current.markRead({ agent: 'no-session', file, text: 'old\ntext\n', whole: true });
    expect(fileReads.current.hasRead({ agent: 'no-session', file })).toBe(true);

    await remove('existing.ts');

    expect(fileReads.current.hasRead({ agent: 'no-session', file })).toBe(false);
    expect(fileReads.current.hasSeen({ agent: 'no-session', file, text: 'old' })).toBe(false);
  });

  it('takes turns with an edit of the same file, so neither starts from stale content', async () => {
    const tools = [createDeleteFileTool(shared()), createEditFileTool(shared())];
    const file = await realpath(path.join(temp.root, 'existing.ts'));

    fileReads.current.markRead({ agent: 'no-session', file, text: 'old\ntext\n', whole: true });

    const [deleted, edited] = await Promise.all([
      call('delete_file', { path: 'existing.ts' }, tools),
      call('edit_file', { path: 'existing.ts', oldText: 'old', newText: 'new' }, tools),
    ]);
    const before = (deleted.artifacts?.find(isFileChange) as { before: string }).before;

    // Whichever ran first, the delete saw what the other left: the edit's text, or the original
    // when the delete went first and the edit then found nothing to change.
    if (edited.isError) {
      expect(edited.content).toContain('File not found');
      expect(before).toBe('old\ntext\n');
    } else {
      expect(before).toBe('new\ntext\n');
    }

    expect(deleted.isError).toBe(false);
    expect(existsSync(path.join(temp.root, 'existing.ts'))).toBe(false);
  });
});
