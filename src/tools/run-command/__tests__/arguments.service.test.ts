import { symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.service';
import { ApprovalRegistry } from '../../../runtime/approvals/approvals.service.js';
import type {
  ApprovalRequest,
  ApprovalResponse,
} from '../../../runtime/approvals/approvals.types.js';
import { useTempWorkspace } from '../../../testing/temp-workspace.fake.js';
import { findConcerns } from '../arguments.service.js';
import { createRunCommandTool } from '../run-command.tool.js';
import type { RunCommandOptions } from '../run-command.types.js';

const temp = useTempWorkspace({
  prefix: 'run-command-args-',
  files: { 'src/a.ts': 'a', '.env': 'SECRET=1' },
  outside: { 'secret.txt': 'outside' },
});
const signal = new AbortController().signal;

const concernsOf = (command: string) => {
  const [file = '', ...args] = command.split(' ');

  return findConcerns({ workspace: temp.workspace, file, args });
};

const run = (command: string, options: Omit<RunCommandOptions, 'workspace'> = {}) =>
  runTool({
    tools: [createRunCommandTool({ workspace: temp.workspace, allowList: ['ls *'], ...options })],
    call: { id: '1', name: 'run_command', input: { description: 'listing', command } },
    signal,
  });

/** A UI stand-in: answers every `approval_requested` with `response` and records the requests. */
function answeringUi(response: ApprovalResponse) {
  const approvals = new ApprovalRegistry();
  const asked: ApprovalRequest[] = [];

  approvals.subscribe((update) => {
    if (update.type !== 'approval_requested') return;
    asked.push(update.request);
    approvals.respond({ id: update.request.id, response });
  });

  return { asked, approvals };
}

describe('findConcerns', () => {
  it.each([
    ['git diff --no-index .env /dev/null', ['--no-index', '.env', '/dev/null']],
    ['git log -p --all -- .env', ['-p', '.env']],
    ['ls -la ../..', ['../..']],
    ['git log -- :(top).env', [':(top).env']],
    ['git show HEAD:.env', ['show']],
    ['ls --directory=../', ['../']],
    ['git diff --no-index . src', ['--no-index']],
    ['git log --all -- c*', ['c*']],
    ['git diff -O../../x', ['-O../../x', '../../x']],
    ['git log -L1,+5:.env', ['-L1,+5:.env', '1,+5:.env']],
    ['git log -- config?.env', ['config?.env']],
    ['git log -- .en[^x]', ['.en[^x]']],
    ['git log -- con?ig/.e*', ['con?ig/.e*']],
  ])('asks before %s, naming %o', async (command, named) => {
    const flagged = (await concernsOf(command)).map((concern) => concern.argument);

    expect(flagged).toEqual(expect.arrayContaining(named));
  });

  it.each([
    'git diff', // any patch can print a committed .env
    'git diff src .', // in a workspace that isn't a repo, git diffs the folders on disk
    'git diff HEAD~1',
    'git diff --stat --patch-with-stat',
    'git log -p',
    'git log --patch --all',
    'git log --patch-with-stat',
    'git log --word-diff-regex=.',
    'git log -U3',
    'git log --stat -p',
    'git log --oneline -GAPI_KEY=sk', // a match per guess leaks a secret bit by bit
    'git log -S secret',
    'git status -v',
    'git status --verbose',
    'git show HEAD',
    'git log --output=out/x',
  ])('asks before %s, which can print or write file contents', async (command) => {
    expect(await concernsOf(command)).not.toEqual([]);
  });

  it.each([
    'git status',
    'git status -sb',
    'git status --porcelain --untracked-files=all',
    'git log --oneline -n 5',
    'git log -20 --graph --decorate',
    'git log --stat',
    'git diff --stat',
    'git diff --name-only HEAD~1',
    'git diff --numstat -- src',
    'ls -la src',
  ])('runs %s without asking: it shows no file contents', async (command) => {
    expect(await concernsOf(command)).toEqual([]);
  });

  it('flags an absolute path outside the workspace', async () => {
    const concerns = await findConcerns({
      workspace: temp.workspace,
      file: 'ls',
      args: [path.join(temp.base, 'secret.txt')],
    });

    expect(concerns).toEqual([
      { argument: path.join(temp.base, 'secret.txt'), reason: 'reaches outside the workspace' },
    ]);
  });

  it('flags symlinks that point outside the workspace or at a .env file', async () => {
    await symlink(path.join(temp.base, 'secret.txt'), path.join(temp.root, 'out-link'));
    await symlink(path.join(temp.root, '.env'), path.join(temp.root, 'env-link'));

    const concerns = await concernsOf('ls out-link env-link');

    expect(concerns).toEqual([
      { argument: 'out-link', reason: 'reaches outside the workspace' },
      { argument: 'env-link', reason: 'is a symlink to a .env file, which holds secrets' },
    ]);
  });

  it('passes in-workspace paths, flags and non-path arguments', async () => {
    const absoluteInside = path.join(temp.root, 'src/a.ts');

    expect(await concernsOf('git diff --stat HEAD~1 -- src/a.ts')).toEqual([]);
    expect(await concernsOf(`ls -la src ./src/a.ts ${absoluteInside} missing-file`)).toEqual([]);
  });

  it('flags a path the sandbox cannot check (a symlink loop), instead of letting it through', async () => {
    await symlink('loop-b', path.join(temp.root, 'loop-a'));
    await symlink('loop-a', path.join(temp.root, 'loop-b'));

    expect(await concernsOf('ls loop-a')).toEqual([
      { argument: 'loop-a', reason: 'could not be checked (ELOOP)' },
    ]);
  });
});

describe('run_command argument approval', () => {
  it('runs a command with safe arguments without asking', async () => {
    const { asked, approvals } = answeringUi({ decision: 'skip' });
    const result = await run('ls src', { approvals });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('a.ts');
    expect(asked).toEqual([]);
  });

  it('runs a risky command once the user approves it', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });
    const result = await run('ls ..', { approvals });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('secret.txt');
    expect(asked).toMatchObject([
      {
        callId: '1',
        tool: 'run_command',
        command: 'ls ..',
        concerns: [{ argument: '..', reason: 'reaches outside the workspace' }],
        options: ['approve', 'skip', 'skip_with_message'],
      },
    ]);
  });

  it.each([
    [{ decision: 'skip' } as const, 'Do not retry it without asking the user.'],
    [
      { decision: 'skip_with_message', message: 'list src instead' } as const,
      'Instead, the user says: list src instead',
    ],
  ])('does not run a risky command the user skips (%o)', async (response, steer) => {
    const { approvals } = answeringUi(response);
    const result = await run('ls ..', { approvals });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('The user skipped this command: ls ..');
    expect(result.content).toContain('- ..: reaches outside the workspace');
    expect(result.content).toContain(steer);
    expect(result.content).not.toContain('secret.txt');
  });

  it.each([
    ['no registry', {}],
    ['a registry no one listens to', { approvals: new ApprovalRegistry() }],
  ])('refuses a risky command with %s', async (_, options) => {
    const result = await run('ls .env', options);

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("Command refused, it needs the user's approval: ls .env");
    expect(result.content).toContain('- .env: can name a .env file');
  });

  it('checks the allow list first: a command not on it is never offered for approval', async () => {
    const { asked, approvals } = answeringUi({ decision: 'approve' });
    const result = await run('cat .env', { approvals });

    expect(result.content).toContain('Command not in allow list: cat .env');
    expect(asked).toEqual([]);
  });
});
