import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { isFileChange } from '../../files/files.utils.js';
import { createWriteFileTool } from '../write-file.tool.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const signal = new AbortController().signal;
const temp = useTempWorkspace({
  prefix: 'write-file-test-',
  perTest: true,
  files: { 'existing.ts': 'old\n' },
  outside: { 'outside.txt': 'outside\n' },
});

const fileLocks = useFileLocks();

const write = (filePath: string, content: string) =>
  runTool({
    tools: [createWriteFileTool({ workspace: temp.workspace, fileLocks: fileLocks.current })],
    call: {
      id: callIdSchema.parse('1'),
      name: 'write_file',
      input: { description: `writing ${filePath}`, path: filePath, content },
    },
    signal,
  });

describe('write_file', () => {
  it('creates a file, with missing folders, and reports before: null', async () => {
    const result = await write('src/new/a.ts', 'export const a = 1;\n');

    expect(result).toMatchObject({ isError: false, content: 'Created src/new/a.ts (0 → 2 lines)' });
    expect(result.artifacts).toEqual([
      { kind: 'file_change', path: 'src/new/a.ts', before: null, after: 'export const a = 1;\n' },
    ]);
    expect(await readFile(path.join(temp.root, 'src/new/a.ts'), 'utf8')).toBe(
      'export const a = 1;\n',
    );
  });

  it('overwrites a file, and reports the old content as before', async () => {
    const result = await write('existing.ts', 'new\n');

    expect(result.content).toBe('Overwrote existing.ts (2 → 2 lines)');
    expect(result.artifacts).toEqual([
      { kind: 'file_change', path: 'existing.ts', before: 'old\n', after: 'new\n' },
    ]);
    expect(await readFile(path.join(temp.root, 'existing.ts'), 'utf8')).toBe('new\n');
  });

  it('refuses paths outside the workspace, and writes nothing', async () => {
    const result = await write('../outside.txt', 'pwned');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Path is outside the workspace');
    expect(result.artifacts).toBeUndefined();
    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it('refuses to write through a symlink that points outside', async () => {
    await symlink(path.join(temp.base, 'outside.txt'), path.join(temp.root, 'link.txt'));

    expect((await write('link.txt', 'pwned')).content).toContain('Path is outside the workspace');
    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it.each(['.env', '.env.local', 'nested/.env.production'])('refuses to write %s', async (file) => {
    const result = await write(file, 'SECRET=x');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Writing .env files is not allowed');
  });

  it('refuses a symlink that points at a .env file', async () => {
    await writeFile(path.join(temp.root, '.env'), 'SECRET=hunter2\n');
    await symlink(path.join(temp.root, '.env'), path.join(temp.root, 'innocent.txt'));

    expect((await write('innocent.txt', 'x')).content).toContain(
      'Writing .env files is not allowed',
    );
    expect(await readFile(path.join(temp.root, '.env'), 'utf8')).toBe('SECRET=hunter2\n');
  });

  it.each(['.git/config', '.git/hooks/pre-commit', 'sub/.git/config', '.Git/config', '.git'])(
    'refuses to write %s, and writes nothing',
    async (file) => {
      const result = await write(file, '[core]\n\tfsmonitor = ./pwn.sh\n');

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('Writing inside .git is not allowed');
      expect(existsSync(path.join(temp.root, file))).toBe(false);
    },
  );

  it('refuses a symlink that points into .git', async () => {
    await mkdir(path.join(temp.root, '.git'));
    await symlink(path.join(temp.root, '.git'), path.join(temp.root, 'meta'));

    expect((await write('meta/config', 'x')).content).toContain(
      'Writing inside .git is not allowed',
    );
    expect(existsSync(path.join(temp.root, '.git/config'))).toBe(false);
  });

  it('still writes files whose names only contain .git', async () => {
    const result = await write('.gitignore', 'node_modules\n');

    expect(result).toMatchObject({ isError: false });
    expect((await write('docs/.github/x.md', 'x')).isError).toBe(false);
  });

  it('takes turns with parallel edit_file calls on one file, each from the last one written', async () => {
    const lines = ['a = 0;', 'b = 0;', 'c = 0;'];
    const base = `${lines.join('\n')}\n`;
    // Both tools on the test's one set of locks, as `createHarness` wires them.
    const tools = [
      createWriteFileTool({ workspace: temp.workspace, fileLocks: fileLocks.current }),
      createEditFileTool({ workspace: temp.workspace, fileLocks: fileLocks.current }),
    ];
    const call = (name: string, input: Record<string, unknown>) =>
      runTool({
        tools,
        call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
        signal,
      });

    await write('mixed.ts', base);

    const results = await Promise.all([
      call('write_file', { path: 'mixed.ts', content: `${base}f = 0;\n` }),
      ...lines.map((line) => call('edit_file', { path: 'mixed.ts', oldText: line, newText: 'z;' })),
      call('write_file', { path: 'mixed.ts', content: `${base}g = 0;\n` }),
    ]);
    const pending = results.map((result) => result.artifacts?.find(isFileChange));
    let content = base;

    // The calls may take the file in any order, but they must form one chain: every change
    // starts from what the previous one wrote, so none was based on stale content.
    while (pending.length > 0) {
      const index = pending.findIndex((change) => change?.before === content);

      expect(index).not.toBe(-1);
      content = pending.splice(index, 1)[0]?.after ?? '';
    }

    expect(results.every((result) => !result.isError)).toBe(true);
    expect(await readFile(path.join(temp.root, 'mixed.ts'), 'utf8')).toBe(content);
  });
});
