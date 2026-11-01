import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.service';
import { useTempWorkspace } from '../../../testing/temp-workspace.fake.js';
import { createEditFileTool } from '../edit-file.tool.js';
import { applyEdit } from '../edit-file.utils.js';

const signal = new AbortController().signal;
const APP = 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n';
const temp = useTempWorkspace({
  prefix: 'edit-file-test-',
  perTest: true,
  files: { 'app.ts': APP },
  outside: { 'outside.txt': 'const a = 1;\n' },
});

const edit = (input: { path: string; oldText: string; newText: string; replaceAll?: boolean }) =>
  runTool({
    tools: [createEditFileTool({ workspace: temp.workspace })],
    call: { id: '1', name: 'edit_file', input: { description: `editing ${input.path}`, ...input } },
    signal,
  });

const onDisk = () => readFile(path.join(temp.root, 'app.ts'), 'utf8');

describe('edit_file', () => {
  it('replaces text that occurs once, and reports before and after', async () => {
    const result = await edit({ path: 'app.ts', oldText: 'const b = 2;', newText: 'const b = 3;' });
    const after = 'const a = 1;\nconst b = 3;\nconst a2 = 1;\n';

    expect(result).toMatchObject({ isError: false, content: 'Edited app.ts (4 → 4 lines)' });
    expect(result.change).toEqual({ path: 'app.ts', before: APP, after });
    expect(await onDisk()).toBe(after);
  });

  it('refuses ambiguous text unless replaceAll is set', async () => {
    const ambiguous = await edit({ path: 'app.ts', oldText: '= 1;', newText: '= 9;' });

    expect(ambiguous).toMatchObject({ isError: true });
    expect(ambiguous.content).toContain('occurs 2 times');
    expect(await onDisk()).toBe(APP);

    const all = await edit({ path: 'app.ts', oldText: '= 1;', newText: '= 9;', replaceAll: true });

    expect(all.content).toBe('Edited app.ts (4 → 4 lines), 2 replacements');
    expect(await onDisk()).toBe('const a = 9;\nconst b = 2;\nconst a2 = 9;\n');
  });

  it('explains missing text and missing files, and changes nothing', async () => {
    const notFound = await edit({ path: 'app.ts', oldText: 'const c', newText: 'x' });
    const noFile = await edit({ path: 'nope.ts', oldText: 'x', newText: 'y' });

    expect(notFound.content).toContain('oldText was not found in app.ts');
    expect(noFile.content).toContain('File not found: nope.ts. Use write_file to create it.');
    expect(notFound.change).toBeUndefined();
    expect(await onDisk()).toBe(APP);
  });

  it('refuses paths outside the workspace and .env files', async () => {
    await writeFile(path.join(temp.root, '.env'), 'SECRET=hunter2\n');
    await symlink(path.join(temp.base, 'outside.txt'), path.join(temp.root, 'link.ts'));

    expect((await edit({ path: '../outside.txt', oldText: '1', newText: '2' })).content).toContain(
      'Path is outside the workspace',
    );
    expect((await edit({ path: 'link.ts', oldText: '1', newText: '2' })).content).toContain(
      'Path is outside the workspace',
    );
    expect((await edit({ path: '.env', oldText: 'hunter2', newText: 'x' })).content).toContain(
      'Writing .env files is not allowed',
    );
    expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('const a = 1;\n');
    expect(await readFile(path.join(temp.root, '.env'), 'utf8')).toBe('SECRET=hunter2\n');
  });

  it('refuses files inside .git, directly or through a symlink', async () => {
    const config = '[core]\n\tbare = false\n';

    await mkdir(path.join(temp.root, '.git'));
    await writeFile(path.join(temp.root, '.git/config'), config);
    await symlink(path.join(temp.root, '.git/config'), path.join(temp.root, 'config.txt'));

    for (const target of ['.git/config', '.GIT/config', 'config.txt']) {
      expect((await edit({ path: target, oldText: 'false', newText: 'true' })).content).toContain(
        'Writing inside .git is not allowed',
      );
    }

    expect(await readFile(path.join(temp.root, '.git/config'), 'utf8')).toBe(config);
  });
});

describe('applyEdit', () => {
  const base = { replaceAll: false, requested: 'f.ts' };

  it('inserts newText literally, even with $ patterns', () => {
    expect(applyEdit({ ...base, before: 'price: X', oldText: 'X', newText: '$&$1' }).after).toBe(
      'price: $&$1',
    );
  });

  it('refuses a no-op edit', () => {
    expect(() => applyEdit({ ...base, before: 'a', oldText: 'a', newText: 'a' })).toThrow(
      'nothing to change',
    );
  });
});
