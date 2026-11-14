import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { CommandRefusedError } from '../../errors/run-command.errors.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { confirmCommand } from '../command-approval.helper.js';
import { commandBase } from '../command-base.utils.js';

const call = { callId: callIdSchema.parse('1') };
const signal = new AbortController().signal;
const steps: [{ argv: [string, ...string[]] }] = [{ argv: ['echo', 'hi'] }];

const confirm = (outsideCwd?: string) =>
  confirmCommand({
    tool: 'run_command',
    command: 'echo hi',
    steps,
    permissions: testPermissions({ mode: 'ask', allow: ['echo *'] }),
    approvals: undefined,
    call,
    signal,
    outsideCwd,
  });

const confirmGit = (argv: [string, ...string[]], mode: 'ask' | 'allow_all' = 'ask') =>
  confirmCommand({
    tool: 'run_command',
    command: argv.join(' '),
    steps: [{ argv }],
    permissions: testPermissions({ mode, allow: ['git *'] }),
    approvals: undefined,
    call,
    signal,
  });

describe('confirmCommand with a folder outside the workspace root', () => {
  it('lets an allowed command run in the root', async () => {
    await expect(confirm()).resolves.toBeUndefined();
  });

  it('asks about an allowed command, naming the folder, in a sibling worktree', async () => {
    const refused = confirm('/work/repo-207');

    await expect(refused).rejects.toBeInstanceOf(CommandRefusedError);
    await expect(refused).rejects.toThrow('/work/repo-207');
  });
});

describe('confirmCommand with git worktree changes', () => {
  it.each([
    ['add', ['git', 'worktree', 'add', '../wt']],
    ['move', ['git', 'worktree', 'move', 'a', 'b']],
    ['repair', ['git', 'worktree', 'repair']],
  ] as const)('asks about `git worktree %s` even though git is allowed', async (_name, argv) => {
    const refused = confirmGit([...argv]);

    await expect(refused).rejects.toBeInstanceOf(CommandRefusedError);
    await expect(refused).rejects.toThrow('readable and writable by the file tools');
  });

  describe.each([
    ['/usr/bin/git'],
    ['git', '-C', 'worktree'],
    ['/usr/bin/git', '-C', 'worktree'],
    ['git', '--work-tree', 'worktree'],
    ['git', '-c', 'core.bare=false'],
    ['git', '--git-dir', '.git'],
    ['git', '--namespace', 'test'],
    ['git', '--config-env', 'core.bare=TEST_VALUE'],
    ['git', '--shallow-file', '/dev/null'],
    ['git', '--attr-source', 'HEAD'],
    ['git', '--attr-source=HEAD'],
    ['/usr/bin/git', '-C', 'worktree', '--attr-source', 'HEAD'],
  ])('with Git prefix %j', (...prefix) => {
    it.each(['add', 'move', 'repair'])(
      'asks about worktree %s despite an existing Git grant',
      async (operation) => {
        expect(commandBase([...prefix, 'worktree', operation])).toEqual(['git', 'worktree']);
        const refused = confirmGit([
          prefix[0],
          ...prefix.slice(1),
          'worktree',
          operation,
          'a',
          'b',
        ]);

        await expect(refused).rejects.toBeInstanceOf(CommandRefusedError);
        await expect(refused).rejects.toThrow('readable and writable by the file tools');
      },
    );

    it('allows read-only worktree listing with the same prefix', async () => {
      await expect(
        confirmGit([prefix[0], ...prefix.slice(1), 'worktree', 'list']),
      ).resolves.toBeUndefined();
    });
  });

  it('does not mistake option operands and log arguments for a worktree operation', async () => {
    await expect(
      confirmGit(['git', '-C', 'worktree', 'log', '--', 'worktree', 'add']),
    ).resolves.toBeUndefined();
  });

  it('does not ask about the read-only `git worktree list`', async () => {
    await expect(confirmGit(['git', 'worktree', 'list'])).resolves.toBeUndefined();
  });

  it('asks nothing in allow_all, as for every command', async () => {
    await expect(
      confirmGit(['git', 'worktree', 'add', '../wt'], 'allow_all'),
    ).resolves.toBeUndefined();
  });
});
