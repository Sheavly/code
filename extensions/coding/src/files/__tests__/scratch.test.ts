import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { agentIdFor, useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { createWriteFileTool } from '../../write-file/write-file.tool.js';

const signal = new AbortController().signal;
const fileLocks = useFileLocks();
const fileReads = useFileReads();
let base: string;
let workspace: Workspace;
let scratch: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'file-scratch-test-'));
  await mkdir(path.join(base, 'workspace'));
  await mkdir(path.join(base, 'other'));
  await writeFile(path.join(base, 'other', 'x.txt'), 'other\n');
  workspace = await Workspace.open(path.join(base, 'workspace'), {
    scratchRoot: path.join(base, 'scratch'),
  });
  scratch = workspace.scratchRoot!;
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const call = (name: 'read_file' | 'write_file' | 'edit_file', input: Record<string, unknown>) => {
  const shared = { workspace, fileLocks: fileLocks.current, fileReads: fileReads.current };

  const tools = [
    createWriteFileTool(shared),
    createEditFileTool(shared),
    createReadFileTool(shared),
  ];

  return runTool({
    signal,
    call: { id: callIdSchema.parse('scratch'), name, input: { description: name, ...input } },
    tools,
  });
};

describe('file tools and the scratch folder', () => {
  it('writes, reads and edits a file in scratch', async () => {
    const file = path.join(await workspace.scratchDir(agentIdFor('agent-a')), 'note.md');

    expect((await call('write_file', { path: file, content: 'one\n' })).isError).toBeFalsy();
    expect((await call('read_file', { path: file })).isError).toBeFalsy();
    expect(
      (await call('edit_file', { path: file, oldText: 'one', newText: 'two' })).isError,
    ).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('two\n');
  });

  it('reads a file another agent folder holds', async () => {
    const file = path.join(await workspace.scratchDir(agentIdFor('agent-b')), 'handoff.md');

    await writeFile(file, 'for you\n');
    expect((await call('read_file', { path: file })).isError).toBeFalsy();
  });

  it('refuses the rest of the temp directory and escapes', async () => {
    for (const requested of [
      path.join(base, 'other', 'x.txt'),
      path.join(scratch, '..', 'other', 'x.txt'),
    ]) {
      expect((await call('read_file', { path: requested })).isError, requested).toBe(true);
    }
  });

  it('reports a scratch change by absolute path, and ignores a .git above the scratch root', async () => {
    const gitParent = path.join(base, '.git-parent', '.git');
    const inGit = await Workspace.open(path.join(base, 'workspace'), {
      scratchRoot: path.join(gitParent, 'scratch'),
    });
    const file = path.join(await inGit.scratchDir(agentIdFor('agent-g')), 'note.md');
    const tool = createWriteFileTool({
      workspace: inGit,
      fileLocks: fileLocks.current,
      fileReads: fileReads.current,
    });
    const result = await runTool({
      signal,
      call: {
        id: callIdSchema.parse('git'),
        name: 'write_file',
        input: { description: 'write', path: file, content: 'x\n' },
      },
      tools: [tool],
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.artifacts)).toContain(file);
  });

  it('still refuses writing inside the workspace .git, by relative or absolute path or a link', async () => {
    const git = path.join(workspace.root, '.git');

    await mkdir(git, { recursive: true });
    await symlink(git, path.join(scratch, 'git-link'));

    for (const requested of [
      '.git/config',
      path.join(git, 'config'),
      path.join(scratch, 'git-link', 'config'),
    ]) {
      expect((await call('write_file', { path: requested, content: 'x' })).isError, requested).toBe(
        true,
      );
    }
  });

  it('still refuses .env files in scratch', async () => {
    const file = path.join(await workspace.scratchDir(agentIdFor('agent-a')), '.env');

    await writeFile(file, 'SECRET=1\n');
    expect((await call('read_file', { path: file })).isError).toBe(true);
    expect((await call('write_file', { path: `${file}.local`, content: 'x' })).isError).toBe(true);
  });
});
