import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { approveEverything } from '@sheavly/runtime/testing/approvals.fake';
import { useTempWorkspace } from '../../../testing/temp-workspace.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';
import { safeGitArgs } from '../run-command.utils.js';

/**
 * A repo whose `.git/config` was poisoned to run a program from git status, diff and log: the
 * commands run_command allows must not run any of them.
 */
const temp = useTempWorkspace({ prefix: 'run-command-git-', files: { 'a.txt': 'a\n' } });
const signal = new AbortController().signal;
const PROGRAMS = ['fsmonitor', 'external', 'textconv', 'filter'];
const marker = (name: string) => path.join(temp.base, `ran-${name}`);
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: temp.root, stdio: 'pipe' });

beforeAll(async () => {
  git('init', '-q');
  await writeFile(path.join(temp.root, '.gitattributes'), 'a.txt diff=conv\n');
  git('add', 'a.txt', '.gitattributes');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'a');
  // Each program leaves a marker file outside the workspace when git runs it.
  git('config', 'core.fsmonitor', `touch ${marker('fsmonitor')}; exit 1`);
  git('config', 'diff.external', `touch ${marker('external')}; true`);
  git('config', 'diff.conv.textconv', `touch ${marker('textconv')}; cat`);
  git('config', 'filter.pwn.clean', `touch ${marker('filter')}; cat`);
  await writeFile(path.join(temp.root, 'a.txt'), 'a\nb\n');
  // The agent may edit .gitattributes, so it can switch on a filter the config defines.
  await writeFile(path.join(temp.root, '.gitattributes'), 'a.txt diff=conv filter=pwn\n');
});

beforeEach(async () => {
  await Promise.all(PROGRAMS.map((name) => rm(marker(name), { force: true })));
});

const approveAll = () => {
  const approvals = new ApprovalRegistry();

  approveEverything(approvals);

  return approvals;
};

const run = (command: string) =>
  runTool({
    tools: [createRunCommandTool({ workspace: temp.workspace, approvals: approveAll() })],
    call: { id: '1', name: 'run_command', input: { description: `running ${command}`, command } },
    signal,
  });

const ranPrograms = () => PROGRAMS.filter((name) => existsSync(marker(name)));

describe('run_command with a poisoned .git/config', () => {
  it('is a real threat: plain git runs the programs', () => {
    git('status', '--short');
    git('diff');
    git('diff', '--no-ext-diff'); // textconv runs only when the external diff doesn't
    expect(ranPrograms()).toEqual(PROGRAMS);
  });

  it.each(['git status', 'git status -sb', 'git diff --stat', 'git diff', 'git log -p -n 1'])(
    '%s runs none of them',
    async (command) => {
      const result = await run(command);

      expect(result.content).toContain('[exit code 0]');
      expect(ranPrograms()).toEqual([]);
    },
  );

  it('still shows the real diff', async () => {
    expect((await run('git diff')).content).toContain('+b');
  });
});

describe('run_command in a repo without commits', () => {
  const fresh = useTempWorkspace({ prefix: 'run-command-git-new-', files: { 'b.txt': 'b\n' } });

  it('runs git status and git diff --stat (no HEAD to read attributes from)', async () => {
    execFileSync('git', ['init', '-q'], { cwd: fresh.root });
    execFileSync('git', ['add', 'b.txt'], { cwd: fresh.root });

    const tool = createRunCommandTool({ workspace: fresh.workspace });

    for (const command of ['git status -sb', 'git diff --stat --cached']) {
      const result = await runTool({
        tools: [tool],
        call: { id: '1', name: 'run_command', input: { description: command, command } },
        signal,
      });

      expect(result.content).toContain('[exit code 0]');
      expect(result.content).toContain('b.txt');
    }
  });
});

describe('safeGitArgs', () => {
  it('adds the no-diff-program flags after a diff, log or show subcommand', () => {
    expect(safeGitArgs({ file: 'git', args: ['log', '-p', '--', 'a'] })).toEqual([
      'log',
      '--no-ext-diff',
      '--no-textconv',
      '-p',
      '--',
      'a',
    ]);
    expect(safeGitArgs({ file: 'git', args: ['show'] })).toEqual([
      'show',
      '--no-ext-diff',
      '--no-textconv',
    ]);
  });

  it('leaves other commands as they are', () => {
    expect(safeGitArgs({ file: 'git', args: ['status', '-sb'] })).toEqual(['status', '-sb']);
    expect(safeGitArgs({ file: 'ls', args: ['diff'] })).toEqual(['diff']);
  });
});
