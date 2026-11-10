import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import {
  brokenGitEnv,
  forgeWorktreeEntry,
  openWithWorktrees,
  useTempRepo,
} from '@sheavly/workspace/testing/git-repo.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { createRunCommandTool } from '../run-command.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';

/** A forged worktree link must never earn a folder the root's grants; the repo is changed per test. */
const repo = useTempRepo({ prefix: 'run-command-sibling-', perTest: true });

const run = async (input: {
  command: string;
  cwd: string;
  allow?: string[];
  env?: Record<string, string>;
}) =>
  runTool({
    tools: [
      createRunCommandTool({
        processes: testProcesses(),
        workspace: input.env
          ? await Workspace.open(repo.main, { env: input.env })
          : await openWithWorktrees(repo.main),
        permissions: testPermissions({ mode: 'ask', allow: input.allow ?? [] }),
      }),
    ],
    call: {
      id: callIdSchema.parse('1'),
      name: 'run_command',
      input: { description: input.command, command: input.command, cwd: input.cwd },
    },
    signal: new AbortController().signal,
  });

describe('run_command in a sibling worktree', () => {
  it('runs a command the user allowed, with no question', async () => {
    const result = await run({ command: 'echo hi', cwd: repo.worktree, allow: ['echo *'] });

    expect(result).toMatchObject({ isError: false });
  });

  it('refuses a folder a forged worktree entry names, before any question', async () => {
    await forgeWorktreeEntry({ repo, target: repo.outside });

    const forged = await run({ command: 'echo hi', cwd: repo.outside, allow: ['echo *'] });
    const real = await run({ command: 'echo hi', cwd: repo.worktree, allow: ['echo *'] });

    expect(forged).toMatchObject({ isError: true });
    expect(forged.content).toContain('outside the workspace');
    // The entry no longer links back, so the worktree it used to name is not a sibling either.
    expect(real).toMatchObject({ isError: true });
    expect(real.content).toContain('outside the workspace');
  });

  it('runs nothing when git cannot be checked, even for an allowed command', async () => {
    const result = await run({
      command: 'echo hi',
      cwd: repo.worktree,
      allow: ['echo *'],
      env: await brokenGitEnv({ repo }),
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).not.toContain('hi\n');
  });

  it('still asks about `git worktree add`, whatever the folder', async () => {
    const result = await run({
      command: 'git worktree add ../another',
      cwd: repo.worktree,
      allow: ['git *'],
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('readable and writable by the file tools');
  });
});
