import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createDeleteFileTool } from '../../delete-file/delete-file.tool.js';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createGlobTool } from '../../glob/glob.tool.js';
import { createGrepTool } from '../../grep/grep.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { createWriteFileTool } from '../../write-file/write-file.tool.js';
import { MAX_FILE_BYTES } from '../files.constants.js';

// The policy table of the file tools (see "Policy table" in docs/file-tools.md): one asserted
// outcome for every tool and every kind of path, so a difference between tools is a decision
// written here, never an accident.

const temp = useTempWorkspace({
  prefix: 'file-tool-policy-',
  perTest: true,
  files: { 'a.ts': 'const a = 1;\n', '.env': 'SECRET=1\n', '.git/config': '[core]\n' },
  outside: { 'outside.txt': 'outside\n' },
});
const fileLocks = useFileLocks();
const fileReads = useFileReads();
const signal = new AbortController().signal;

const tools = () => {
  const services = {
    workspace: temp.workspace,
    fileLocks: fileLocks.current,
    fileReads: fileReads.current,
  };

  return [
    createReadFileTool(services),
    createWriteFileTool(services),
    createEditFileTool(services),
    createDeleteFileTool(services),
    createGrepTool({ workspace: temp.workspace, processes: testProcesses() }),
    createGlobTool({ workspace: temp.workspace, processes: testProcesses() }),
  ];
};

const call = (name: string, input: Record<string, unknown>, abort: AbortSignal = signal) =>
  runTool({
    tools: tools(),
    call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
    signal: abort,
  });

/** What each tool is asked to do to `file`. */
const REQUESTS: Record<string, (file: string) => Record<string, unknown>> = {
  read_file: (file) => ({ path: file }),
  write_file: (file) => ({ path: file, content: 'x\n' }),
  edit_file: (file) => ({ path: file, oldText: 'a', newText: 'b' }),
  delete_file: (file) => ({ path: file }),
  grep: (file) => ({ pattern: '.', path: file }),
  glob: (file) => ({ pattern: '*', path: file }),
};

const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'delete_file'];
const ALL_TOOLS = [...FILE_TOOLS, 'grep', 'glob'];
const ask = (tool: string, file: string) => call(tool, REQUESTS[tool]!(file));

describe('what every file tool refuses, whatever it is asked to do', () => {
  const REFUSED = [
    { what: 'a .env file', file: '.env', says: /\.env/, tools: ALL_TOOLS },
    { what: 'a file inside .git', file: '.git/config', says: /\.git/, tools: ALL_TOOLS },
    { what: 'a path outside the root', file: '../outside.txt', says: /outside/, tools: ALL_TOOLS },
    { what: 'a symlink out of the root', file: 'link-out.txt', says: /./, tools: ALL_TOOLS },
    {
      what: 'a symlink to a .env file',
      file: 'link-env.txt',
      says: /\.env/,
      tools: ['read_file', 'write_file', 'edit_file'],
    },
    // delete_file refuses every symlink before it looks at the target.
    {
      what: 'a symlink to a .env file',
      file: 'link-env.txt',
      says: /symlink/,
      tools: ['delete_file'],
    },
  ];

  it.each(REFUSED.flatMap((row) => row.tools.map((tool) => ({ ...row, tool }))))(
    '$tool refuses $what',
    async ({ tool, file, says }) => {
      await symlink(path.join(temp.base, 'outside.txt'), path.join(temp.root, 'link-out.txt'));
      await symlink(path.join(temp.root, '.env'), path.join(temp.root, 'link-env.txt'));

      const result = await ask(tool, file);

      expect(result).toMatchObject({ isError: true });
      expect(result.content).toMatch(says);
      expect(await readFile(path.join(temp.root, '.env'), 'utf8')).toBe('SECRET=1\n');
      expect(await readFile(path.join(temp.base, 'outside.txt'), 'utf8')).toBe('outside\n');
      expect(existsSync(path.join(temp.root, '.git/config'))).toBe(true);
    },
  );
});

describe('a symlink inside the root', () => {
  const link = () => path.join(temp.root, 'link-in.ts');

  it('is read as its target, and an edit writes through it to the target', async () => {
    await symlink(path.join(temp.root, 'a.ts'), link());

    expect(await ask('read_file', 'link-in.ts')).toMatchObject({ isError: false });
    expect(await ask('edit_file', 'link-in.ts')).toMatchObject({ isError: false });
    expect(await readFile(path.join(temp.root, 'a.ts'), 'utf8')).toBe('const b = 1;\n');
  });

  it('is not replaced by write_file, which only creates', async () => {
    await symlink(path.join(temp.root, 'a.ts'), link());

    expect((await ask('write_file', 'link-in.ts')).content).toContain('already exists');
  });

  it('is never deleted, and neither is its target', async () => {
    await symlink(path.join(temp.root, 'a.ts'), link());
    await ask('read_file', 'link-in.ts');

    const result = await ask('delete_file', 'link-in.ts');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('symlink');
    expect(existsSync(link())).toBe(true);
    expect(existsSync(path.join(temp.root, 'a.ts'))).toBe(true);
  });
});

describe('reads decide what a change may touch', () => {
  it('refuses an edit and a delete of a file the agent has not read', async () => {
    for (const tool of ['edit_file', 'delete_file']) {
      const result = await ask(tool, 'a.ts');

      expect(result, tool).toMatchObject({ isError: true });
      expect(result.content, tool).toContain('You have not read a.ts');
    }

    expect(await readFile(path.join(temp.root, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
  });

  it('lets a delete through once the file was read', async () => {
    await ask('read_file', 'a.ts');

    expect(await ask('delete_file', 'a.ts')).toMatchObject({ isError: false });
    expect(existsSync(path.join(temp.root, 'a.ts'))).toBe(false);
  });
});

describe('a file too big to handle', () => {
  const big = () => path.join(temp.root, 'big.txt');

  it.each(['read_file', 'edit_file'])('is refused by %s before it is loaded', async (tool) => {
    await writeFile(big(), 'x'.repeat(MAX_FILE_BYTES + 1));

    const result = await ask(tool, 'big.txt');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain(`${MAX_FILE_BYTES + 1} bytes`);
  });

  it('is not written by write_file', async () => {
    const result = await call('write_file', {
      path: 'big.txt',
      content: 'x'.repeat(MAX_FILE_BYTES + 1),
    });

    expect(result).toMatchObject({ isError: true });
    expect(existsSync(big())).toBe(false);
  });
});

describe('an aborted call', () => {
  const aborted = () => AbortSignal.abort(new Error('stopped'));

  it.each(ALL_TOOLS)('%s fails and changes nothing', async (tool) => {
    await ask('read_file', 'a.ts');

    const result = await call(tool, REQUESTS[tool]!('a.ts'), aborted());

    expect(result, tool).toMatchObject({ isError: true });
    expect(await readFile(path.join(temp.root, 'a.ts'), 'utf8')).toBe('const a = 1;\n');
  });
});
