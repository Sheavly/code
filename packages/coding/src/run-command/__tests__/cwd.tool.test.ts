import path from 'node:path';
import { symlink, writeFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { openWithWorktrees, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { createRunCommandTool } from '../run-command.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';

const signal = new AbortController().signal;
const callId = callIdSchema.parse('1');

const repo = useTempRepo({ prefix: 'run-command-cwd-' });
let workspace: Workspace;

beforeAll(async () => {
  workspace = await openWithWorktrees(repo.main);
});

const run = (input: { command: string; cwd?: string }, mode: 'ask' | 'allow_all' = 'allow_all') =>
  runTool({
    tools: [
      createRunCommandTool({
        processes: testProcesses(),
        workspace,
        permissions: testPermissions({ mode }),
      }),
    ],
    call: {
      id: callId,
      name: 'run_command',
      input: { description: `running ${input.command}`, ...input },
    },
    signal,
  });

describe('run_command with a cwd', () => {
  it('runs in a sibling git worktree', async () => {
    const result = await run({ command: 'pwd', cwd: repo.worktree });

    expect(result).toMatchObject({ isError: false });
    expect(result.content.endsWith(repo.worktree)).toBe(true);
  });

  it('needs the user approval in a sibling worktree even for a built-in command', async () => {
    const result = await run({ command: 'pwd', cwd: repo.worktree }, 'ask');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain(`run in ${repo.worktree}`);
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
