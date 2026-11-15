import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import type { Tool } from '@sheavly/core/tool/tool.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { FileLocks } from '@sheavly/workspace/file-locks/file-locks.service';
import { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { useTempRepo, openWithWorktrees } from '@sheavly/workspace/testing/git-repo.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import {
  memoryWorkingRootStore,
  testWorkingRoots,
} from '@sheavly/workspace/testing/working-root-store.fake';
import { createDeleteFileTool } from '../../delete-file/delete-file.tool.js';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createGlobTool } from '../../glob/glob.tool.js';
import { createGrepTool } from '../../grep/grep.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { createRunCommandTool } from '../../run-command/run-command.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createWriteFileTool } from '../../write-file/write-file.tool.js';
import { createSetWorkingRootTool } from '../set-working-root.tool.js';

const repo = useTempRepo({ prefix: 'working-root-tools-', perTest: true });

async function setup() {
  const workspace = await openWithWorktrees(repo.main);
  const workingRoots = testWorkingRoots({ workspace });
  const fileReads = new FileReads();
  const services = { workspace, workingRoots, fileLocks: new FileLocks(), fileReads };

  return { workspace, workingRoots, fileReads, services };
}

function call(tool: Tool, input: Record<string, unknown>) {
  return runTool({
    tools: [tool],
    call: { id: callIdSchema.parse('1'), name: tool.name, input: { description: 'x', ...input } },
    signal: new AbortController().signal,
  });
}

describe('set_working_root', () => {
  it('sets a sibling worktree, names its branch, and clears it again', async () => {
    const { workingRoots } = await setup();
    const tool = createSetWorkingRootTool({ workingRoots });

    const set = await call(tool, { path: repo.worktree });

    expect(set).toMatchObject({ isError: false });
    expect(set.content).toContain('branch feature');
    await expect(workingRoots.get()).resolves.toMatchObject({ root: repo.worktree });

    const cleared = await call(tool, {});

    expect(cleared.content).toContain('cleared');
    await expect(workingRoots.get()).resolves.toBeUndefined();
  });

  it('refuses a folder the workspace cannot reach, and leaves the root as it was', async () => {
    const { workingRoots } = await setup();
    const result = await call(createSetWorkingRootTool({ workingRoots }), { path: repo.outside });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('outside the workspace');
    await expect(workingRoots.get()).resolves.toBeUndefined();
  });

  it('refuses a .env folder as the root, whatever the name it is reached by', async () => {
    const { workingRoots } = await setup();

    await mkdir(path.join(repo.worktree, '.env'));
    const result = await call(createSetWorkingRootTool({ workingRoots }), {
      path: path.join(repo.worktree, '.env'),
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('.env');
    await expect(workingRoots.get()).resolves.toBeUndefined();
  });

  it('refuses .git as the root', async () => {
    const { workingRoots } = await setup();
    const result = await call(createSetWorkingRootTool({ workingRoots }), {
      path: path.join(repo.main, '.git'),
    });

    expect(result).toMatchObject({ isError: true });
    await expect(workingRoots.get()).resolves.toBeUndefined();
  });
});

describe('a working root whose folder is gone', () => {
  async function withGoneRoot() {
    const setUp = await setup();

    await setUp.workingRoots.set(repo.worktree);
    await rm(repo.worktree, { recursive: true });

    return setUp;
  }

  it('fails a relative write instead of writing in the main checkout', async () => {
    const { services } = await withGoneRoot();
    const result = await call(createWriteFileTool(services), {
      path: 'src/new.ts',
      content: 'a\n',
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('can no longer be used');
    await expect(readFile(path.join(repo.main, 'src/new.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails a relative delete instead of deleting in the main checkout', async () => {
    const { services } = await withGoneRoot();
    const result = await call(createDeleteFileTool(services), { path: 'src/index.ts' });

    expect(result).toMatchObject({ isError: true });
    await expect(readFile(path.join(repo.main, 'src/index.ts'), 'utf8')).resolves.toBe(
      'export {};\n',
    );
  });

  it('fails run_command, with no command run in the main checkout', async () => {
    const { workspace, workingRoots } = await withGoneRoot();
    const tool = createRunCommandTool({
      fileReads: new FileReads(),
      workspace,
      workingRoots,
      processes: testProcesses(),
      permissions: testPermissions({ mode: 'ask', allow: ['pwd'] }),
    });
    const result = await call(tool, { command: 'pwd' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('can no longer be used');
    // A command that ran would report its exit code; a refused one never started.
    expect(result.content).not.toContain('[exit code');
  });

  it('works again once the agent sets another root', async () => {
    const { workingRoots, services } = await withGoneRoot();

    await call(createSetWorkingRootTool({ workingRoots }), { path: repo.main });
    const result = await call(createReadFileTool(services), { path: 'src/index.ts' });

    expect(result).toMatchObject({ isError: false });
  });
});

describe('grep and glob with a working root', () => {
  it('search from the root, with paths relative to it', async () => {
    const { workspace, workingRoots } = await setup();
    const processes = testProcesses();

    await workingRoots.set(repo.worktree);
    const result = await call(createGrepTool({ workspace, workingRoots, processes }), {
      pattern: 'export',
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('src/index.ts');
    expect(result.content).not.toContain(repo.worktree);
  });

  it('cannot be pointed into .git by a path, with a root set', async () => {
    const { workspace, workingRoots } = await setup();
    const processes = testProcesses();
    const grep = createGrepTool({ workspace, workingRoots, processes });
    const glob = createGlobTool({ workspace, workingRoots, processes });

    await workingRoots.set(repo.worktree);

    for (const searched of ['.git', path.join(repo.worktree, '.git'), '../wt/.git']) {
      const found = await call(grep, { pattern: 'url', path: searched });
      const listed = await call(glob, { pattern: '*', path: searched });

      expect(found, searched).toMatchObject({ isError: true });
      expect(found.content, searched).toContain('.git');
      expect(listed, searched).toMatchObject({ isError: true });
    }
  });

  it('cannot start inside .git when a stored root already points there', async () => {
    const workspace = await openWithWorktrees(repo.main);
    const store = memoryWorkingRootStore({ workingRoot: path.join(repo.main, '.git') });
    const workingRoots = testWorkingRoots({ workspace, store });
    const processes = testProcesses();

    for (const tool of [
      createGrepTool({ workspace, workingRoots, processes }),
      createGlobTool({ workspace, workingRoots, processes }),
    ]) {
      const result = await call(tool, { pattern: 'url' });

      expect(result, tool.name).toMatchObject({ isError: true });
      expect(result.content, tool.name).toContain('inside .git');
    }
  });
});

describe('file tools with a working root', () => {
  it('reads a relative path from the root, and shows it relative to the root', async () => {
    const { workingRoots, services } = await setup();

    await workingRoots.set(repo.worktree);
    const result = await call(createReadFileTool(services), { path: 'src/index.ts' });

    expect(result).toMatchObject({ isError: false });
    expect(result.artifacts).toEqual([expect.objectContaining({ path: 'src/index.ts' })]);
  });

  it('reads from the workspace root again once the root is cleared', async () => {
    const { workingRoots, services } = await setup();

    await workingRoots.set(repo.worktree);
    await workingRoots.clear();
    const result = await call(createReadFileTool(services), { path: 'src/index.ts' });

    expect(result).toMatchObject({ isError: false });
  });

  it('writes and edits in the root, not the workspace root', async () => {
    const { workingRoots, services } = await setup();

    await workingRoots.set(repo.worktree);
    await call(createWriteFileTool(services), { path: 'src/new.ts', content: 'a\n' });
    const edit = await call(createEditFileTool(services), {
      path: 'src/new.ts',
      oldText: 'a',
      newText: 'b',
    });

    expect(edit).toMatchObject({ isError: false });
    await expect(readFile(path.join(repo.worktree, 'src/new.ts'), 'utf8')).resolves.toBe('b\n');
    await expect(readFile(path.join(repo.main, 'src/new.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('still refuses a path that leaves every worktree', async () => {
    const { workingRoots, services } = await setup();

    await workingRoots.set(repo.worktree);
    const result = await call(createReadFileTool(services), { path: '../outside/secret.txt' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('outside the workspace');
  });

  it('still reaches the old ../worktree form by absolute path', async () => {
    const { workingRoots, services } = await setup();

    await workingRoots.set(repo.worktree);
    const result = await call(createReadFileTool(services), {
      path: path.join(repo.main, 'src/index.ts'),
    });

    expect(result).toMatchObject({ isError: false });
  });
});

describe('run_command with a working root', () => {
  async function pwdTool() {
    const { workspace, workingRoots, fileReads } = await setup();
    const tool = createRunCommandTool({
      fileReads,
      workspace,
      workingRoots,
      processes: testProcesses(),
      permissions: testPermissions({ mode: 'ask', allow: ['pwd'] }),
    });

    await workingRoots.set(repo.worktree);

    return tool;
  }

  it('runs in the root when no cwd is given', async () => {
    const result = await call(await pwdTool(), { command: 'pwd' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain(repo.worktree);
  });

  it('starts a relative cwd from the root', async () => {
    const result = await call(await pwdTool(), { command: 'pwd', cwd: 'src' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain(path.join(repo.worktree, 'src'));
  });
});
