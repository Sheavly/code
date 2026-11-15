import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createEditFileTool } from '../edit-file.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { applyEdit } from '../edit-file.utils.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

const signal = new AbortController().signal;
const callId = callIdSchema.parse('1');
const APP = 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n';
const temp = useTempWorkspace({
  prefix: 'edit-file-test-',
  perTest: true,
  files: { 'app.ts': APP },
  outside: { 'outside.txt': 'const a = 1;\n' },
});

const fileLocks = useFileLocks();
const fileReads = useFileReads();

const run = (params: {
  name: 'read_file' | 'edit_file';
  input: Record<string, unknown>;
  session?: SessionRef;
}) =>
  runTool({
    tools: [
      createReadFileTool({
        workspace: temp.workspace,
        fileLocks: fileLocks.current,
        fileReads: fileReads.current,
      }),
      createEditFileTool({
        workspace: temp.workspace,
        fileLocks: fileLocks.current,
        fileReads: fileReads.current,
      }),
    ],
    call: {
      id: callId,
      name: params.name,
      input: { description: `${params.name} ${String(params.input.path)}`, ...params.input },
    },
    signal,
    ...(params.session && { session: params.session }),
  });

type EditInput = { path: string; oldText: string; newText: string; replaceAll?: boolean };

/** An edit by an agent that has not read the file. */
const editUnread = (input: EditInput, session?: SessionRef) =>
  run({ name: 'edit_file', input, ...(session && { session }) });

/** The file read as an agent does with `read_file`, then edited: the normal flow. */
const edit = async (input: EditInput, session?: SessionRef) => {
  await run({ name: 'read_file', input: { path: input.path }, ...(session && { session }) });

  return editUnread(input, session);
};

const onDisk = () => readFile(path.join(temp.root, 'app.ts'), 'utf8');

describe('edit_file', () => {
  it('replaces text that occurs once, and reports before and after', async () => {
    const result = await edit({ path: 'app.ts', oldText: 'const b = 2;', newText: 'const b = 3;' });
    const after = 'const a = 1;\nconst b = 3;\nconst a2 = 1;\n';

    expect(result).toMatchObject({ isError: false, content: 'Edited app.ts (4 → 4 lines)' });
    expect(result.artifacts).toEqual([{ kind: 'file_change', path: 'app.ts', before: APP, after }]);
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
    expect(notFound.artifacts).toBeUndefined();
    expect(await onDisk()).toBe(APP);
  });

  describe('reading only part of a file', () => {
    /** Lines `line 1` ... `line 30`, so a range read shows a part and not the rest. */
    const LONG = `${Array.from({ length: 30 }, (_, i) => `line ${String(i + 1)}`).join('\n')}\n`;
    const readRange = (startLine: number, endLine: number) =>
      run({ name: 'read_file', input: { path: 'long.ts', startLine, endLine } });
    const editLong = (oldText: string, newText: string, replaceAll = false) =>
      editUnread({ path: 'long.ts', oldText, newText, replaceAll });
    const longOnDisk = () => readFile(path.join(temp.root, 'long.ts'), 'utf8');

    beforeEach(async () => {
      await writeFile(path.join(temp.root, 'long.ts'), LONG);
    });

    it('allows an edit inside the lines that were read', async () => {
      await readRange(10, 12);

      expect(await editLong('line 11', 'LINE 11')).toMatchObject({ isError: false });
      expect(await longOnDisk()).toContain('LINE 11');
    });

    it('refuses an edit to lines that were not read, saying which to read, changing nothing', async () => {
      await readRange(10, 12);

      const result = await editLong('line 25', 'LINE 25');

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('not in what you have read');
      expect(result.content).toContain('startLine');
      expect(await longOnDisk()).toBe(LONG);
    });

    it('lets an edit span lines that were read together, not lines read apart', async () => {
      await readRange(10, 12);
      await readRange(20, 22);

      expect(await editLong('line 10\nline 11', 'A\nB')).toMatchObject({ isError: false });
      // Lines 12 and 20 were each read, but never next to each other.
      expect((await editLong('line 12\nline 20', 'x')).isError).toBe(true);
    });

    it('allows editing again a place the agent just edited, without reading it back', async () => {
      await readRange(10, 12);
      await editLong('line 11', 'LINE 11');

      expect(await editLong('LINE 11', 'LINE ELEVEN')).toMatchObject({ isError: false });
    });

    it('refuses replaceAll unless the whole file was read, since it reaches unread lines', async () => {
      await writeFile(path.join(temp.root, 'long.ts'), `${LONG}line 5\n`);
      await readRange(1, 30);

      const result = await editLong('line 5', 'FIVE', true);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('read all of it');
    });

    it('allows replaceAll after the whole file was read', async () => {
      await run({ name: 'read_file', input: { path: 'long.ts' } });

      expect(await editLong('line 1', 'one', true)).toMatchObject({ isError: false });
      expect(await longOnDisk()).not.toContain('line 1\n');
    });

    it('does not count lines a read cut off: a long line shown in part is only part', async () => {
      const long = 'x'.repeat(200_000);

      await writeFile(path.join(temp.root, 'long.ts'), `head\n${long}\ntail\n`);
      await run({ name: 'read_file', input: { path: 'long.ts' } });

      expect((await editLong('tail', 'TAIL')).isError).toBe(true);
    });

    it('a failed edit (text not found) does not count as having read anything new', async () => {
      await readRange(10, 12);

      await editLong('line 99', 'x');

      expect((await editLong('line 25', 'x')).isError).toBe(true);
    });
  });

  describe('reading first', () => {
    const MAIN = {
      id: sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20'),
      rootId: sessionIdSchema.parse('7d9a2c41-5e0b-4f63-8a17-3c6e9b1d4f20'),
      depth: 0,
    } as unknown as SessionRef;
    const CHILD = {
      id: sessionIdSchema.parse('1b8e4f02-9c3d-4a65-b7e1-6d2f0a9c5e38'),
      rootId: MAIN.id,
      parentId: MAIN.id,
      depth: 1,
    } as unknown as SessionRef;
    const change = { path: 'app.ts', oldText: 'const b = 2;', newText: 'const b = 3;' };

    it('refuses a file the agent never read, saying to read it, and changes nothing', async () => {
      const result = await editUnread(change);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toContain('You have not read app.ts');
      expect(result.content).toContain('read_file');
      expect(result.artifacts).toBeUndefined();
      expect(await onDisk()).toBe(APP);
    });

    it('allows it once the agent has read the file, and again without reading it again', async () => {
      await run({ name: 'read_file', input: { path: 'app.ts' } });

      expect(await editUnread(change)).toMatchObject({ isError: false });
      expect(
        await editUnread({ path: 'app.ts', oldText: 'const b = 3;', newText: 'const b = 4;' }),
      ).toMatchObject({ isError: false });
    });

    it('counts a read through a symlink as a read of the file it points to', async () => {
      await symlink(path.join(temp.root, 'app.ts'), path.join(temp.root, 'alias.ts'));
      await run({ name: 'read_file', input: { path: 'alias.ts' } });

      expect(await editUnread(change)).toMatchObject({ isError: false });
    });

    it('holds each agent to its own reads: a sub-agent must read what its parent read', async () => {
      await run({ name: 'read_file', input: { path: 'app.ts' }, session: MAIN });

      expect(await editUnread(change, MAIN)).toMatchObject({ isError: false });

      const asChild = await editUnread(
        { path: 'app.ts', oldText: 'const b = 3;', newText: 'const b = 4;' },
        CHILD,
      );

      expect(asChild).toMatchObject({ isError: true });
      expect(asChild.content).toContain('You have not read app.ts');
    });

    it('does not count a read that failed', async () => {
      const failed = await run({ name: 'read_file', input: { path: 'nope.ts' } });

      expect(failed).toMatchObject({ isError: true });
      expect(await editUnread({ ...change, path: 'app.ts' })).toMatchObject({ isError: true });
    });
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

  it('applies every parallel edit to one file, also through a symlink to it', async () => {
    const lines = APP.trimEnd().split('\n');

    await symlink(path.join(temp.root, 'app.ts'), path.join(temp.root, 'alias.ts'));

    const results = await Promise.all(
      lines.map((line, index) =>
        edit({
          path: index % 2 === 0 ? 'app.ts' : 'alias.ts',
          oldText: line,
          newText: `${line}//`,
        }),
      ),
    );

    expect(results.map((result) => result.isError)).toEqual(lines.map(() => false));
    expect(await onDisk()).toBe(`${lines.map((line) => `${line}//`).join('\n')}\n`);
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
