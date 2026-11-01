import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.service';
import { Workspace } from '../../../runtime/workspace/workspace.service.js';
import { createWriteFileTool } from '../write-file.tool.js';

/** A fresh temp dir per test: base/outside.txt, and base/workspace/existing.ts. */
let base: string;
let root: string;
let workspace: Workspace;
const signal = new AbortController().signal;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'write-file-test-'));
  root = path.join(base, 'workspace');
  await mkdir(root);
  await writeFile(path.join(base, 'outside.txt'), 'outside\n');
  await writeFile(path.join(root, 'existing.ts'), 'old\n');
  workspace = await Workspace.open(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const write = (filePath: string, content: string) =>
  runTool({
    tools: [createWriteFileTool({ workspace })],
    call: {
      id: '1',
      name: 'write_file',
      input: { description: `writing ${filePath}`, path: filePath, content },
    },
    signal,
  });

describe('write_file', () => {
  it('creates a file, with missing folders, and reports before: null', async () => {
    const result = await write('src/new/a.ts', 'export const a = 1;\n');

    expect(result).toMatchObject({ isError: false, content: 'Created src/new/a.ts (0 → 2 lines)' });
    expect(result.change).toEqual({
      path: 'src/new/a.ts',
      before: null,
      after: 'export const a = 1;\n',
    });
    expect(await readFile(path.join(root, 'src/new/a.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('overwrites a file, and reports the old content as before', async () => {
    const result = await write('existing.ts', 'new\n');

    expect(result.content).toBe('Overwrote existing.ts (2 → 2 lines)');
    expect(result.change).toEqual({ path: 'existing.ts', before: 'old\n', after: 'new\n' });
    expect(await readFile(path.join(root, 'existing.ts'), 'utf8')).toBe('new\n');
  });

  it('refuses paths outside the workspace, and writes nothing', async () => {
    const result = await write('../outside.txt', 'pwned');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Path is outside the workspace');
    expect(result.change).toBeUndefined();
    expect(await readFile(path.join(base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it('refuses to write through a symlink that points outside', async () => {
    await symlink(path.join(base, 'outside.txt'), path.join(root, 'link.txt'));

    expect((await write('link.txt', 'pwned')).content).toContain('Path is outside the workspace');
    expect(await readFile(path.join(base, 'outside.txt'), 'utf8')).toBe('outside\n');
  });

  it.each(['.env', '.env.local', 'nested/.env.production'])('refuses to write %s', async (file) => {
    const result = await write(file, 'SECRET=x');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Writing .env files is not allowed');
  });

  it('refuses a symlink that points at a .env file', async () => {
    await writeFile(path.join(root, '.env'), 'SECRET=hunter2\n');
    await symlink(path.join(root, '.env'), path.join(root, 'innocent.txt'));

    expect((await write('innocent.txt', 'x')).content).toContain(
      'Writing .env files is not allowed',
    );
    expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('SECRET=hunter2\n');
  });
});
