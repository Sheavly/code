import path from 'node:path';
import { symlink, writeFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { openWithWorktrees, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { agentIdFor } from '@sheavly/workspace/testing/file-reads.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createRunCommandTool } from '../run-command.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';

const signal = new AbortController().signal;
const callId = callIdSchema.parse('1');

const repo = useTempRepo({ prefix: 'run-command-cwd-' });
let workspace: Workspace;
let scratchWorkspace: Workspace;

beforeAll(async () => {
  workspace = await openWithWorktrees(repo.main);
  scratchWorkspace = await Workspace.open(repo.main, {
    env: process.env,
    scratchRoot: path.join(repo.base, 'scratch'),
  });
});

type Mode = 'ask' | 'always_ask' | 'allow_all';

const runIn = (input: { workspace: Workspace; command: string; cwd?: string; mode?: Mode }) =>
  runTool({
    tools: [
      createRunCommandTool({
        processes: testProcesses(),
        workspace: input.workspace,
        // `pwd` is built in; `ask` mode makes the rest need a grant.
        permissions: testPermissions({ mode: input.mode ?? 'ask' }),
      }),
    ],
    call: {
      id: callId,
      name: 'run_command',
      input: {
        description: `running ${input.command}`,
        command: input.command,
        ...(input.cwd !== undefined && { cwd: input.cwd }),
      },
    },
    signal,
  });

const run = (input: { command: string; cwd?: string }, mode: Mode = 'allow_all') =>
  runIn({ workspace, ...input, mode });

describe('run_command with a cwd', () => {
  it('runs in a sibling git worktree', async () => {
    const result = await run({ command: 'pwd', cwd: repo.worktree });

    expect(result).toMatchObject({ isError: false });
    expect(result.content.endsWith(repo.worktree)).toBe(true);
  });

  it('runs an allowed command in a sibling worktree without a question', async () => {
    const result = await run({ command: 'pwd', cwd: repo.worktree }, 'ask');

    expect(result).toMatchObject({ isError: false });
    expect(result.content.endsWith(repo.worktree)).toBe(true);
  });

  it('asks about a command that is not allowed in a sibling worktree, as in the root', async () => {
    const result = await run({ command: 'echo hi', cwd: repo.worktree }, 'ask');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('echo hi: is not allowed yet');
    expect(result.content).not.toContain('outside the workspace root');
  });

  it('treats a sub-folder of a sibling worktree like the sibling', async () => {
    const result = await run({ command: 'pwd', cwd: path.join(repo.worktree, 'src') }, 'ask');

    expect(result).toMatchObject({ isError: false });
  });

  it('still asks in a sibling worktree in always_ask mode', async () => {
    const result = await run({ command: 'pwd', cwd: repo.worktree }, 'always_ask');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('is asked about every time');
  });

  it('still asks about every command in the scratch folder, naming it', async () => {
    const scratch = await scratchWorkspace.scratchDir(agentIdFor('agent-1'));
    const result = await runIn({ workspace: scratchWorkspace, command: 'pwd', cwd: scratch });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain(`run in ${scratch}`);
  });

  it('runs in a folder of the workspace, given relative to the root', async () => {
    const result = await run({ command: 'pwd', cwd: 'src' });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain(path.join(repo.main, 'src'));
  });

  it('runs in the workspace root without a cwd', async () => {
    const result = await run({ command: 'pwd' });

    expect(result.content.endsWith(repo.main)).toBe(true);
  });

  it('refuses a folder outside the workspace and every worktree', async () => {
    const result = await run({ command: 'pwd', cwd: repo.outside });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('outside the workspace');
  });

  it('refuses a cwd that is a file', async () => {
    const result = await run({ command: 'pwd', cwd: 'src/index.ts' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('not a directory');
  });

  it('refuses an environment-file cwd before resolving it', async () => {
    const result = await run({ command: 'pwd', cwd: '.env.local' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('.env files is not allowed');
  });

  it('refuses a cwd symlink to an environment file', async () => {
    await writeFile(path.join(repo.main, '.env.test'), 'test fixture');
    await symlink('.env.test', path.join(repo.main, 'env-cwd-link'));
    const result = await run({ command: 'pwd', cwd: 'env-cwd-link' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('.env files is not allowed');
  });

  it('refuses a cwd that does not exist', async () => {
    const result = await run({ command: 'pwd', cwd: 'nope' });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('cwd not found');
  });
});
