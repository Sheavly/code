import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWorktree } from '../bootstrap-worktree.mjs';
import { verifyWorktree } from '../verify-worktree.mjs';
import { createTempRepo, removeTempRepos, REPO_ROOT } from './temp-repo.utils.mjs';

afterEach(removeTempRepos);

function checkout() {
  return createTempRepo(
    {
      '.cursor/hooks.json': readFileSync(path.join(REPO_ROOT, '.cursor/hooks.json'), 'utf8'),
    },
    { linkNodeModules: false },
  );
}

function successfulRun(command, args, options) {
  if (options.input) {
    const { prompt } = JSON.parse(options.input);

    return {
      status: 0,
      stdout: JSON.stringify(
        command.includes('require-issue')
          ? { continue: prompt.startsWith('NO-ISSUE') }
          : { permission: 'allow' },
      ),
    };
  }

  return { status: 0, stdout: args[0] === 'ci' ? 'installed' : '1.0.0', stderr: '' };
}

describe('worktree bootstrap', () => {
  it('installs before probing guards and every quality tool, without touching live chat state', () => {
    const root = checkout();
    const run = vi.fn(successfulRun);

    expect(bootstrapWorktree({ root, run })).toEqual({ root, output: 'installed' });
    expect(run.mock.calls[0]).toMatchObject(['npm', ['ci'], { cwd: root }]);

    const guards = run.mock.calls.filter(([, , options]) => options.input);

    expect(guards).toHaveLength(3);
    const stateDir = guards[0][2].env.SHEAVLY_HOOK_STATE_DIR;

    expect(guards.every(([, , options]) => options.env.SHEAVLY_HOOK_STATE_DIR === stateDir)).toBe(
      true,
    );
    expect(existsSync(stateDir)).toBe(false);
    expect(run.mock.calls.slice(4).map(([command]) => path.basename(command))).toEqual([
      'prettier',
      'eslint',
      'turbo',
      'knip',
      'jscpd',
      'vitest',
      'tsc',
    ]);
  });

  it('stops at installation failure without probing or moving anything', () => {
    const run = vi.fn(() => ({ status: 1, stderr: 'lockfile mismatch' }));

    expect(() => bootstrapWorktree({ root: checkout(), run })).toThrow('lockfile mismatch');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports failed startup with the original error and removes probe state', () => {
    const run = vi.fn((command, args, options) =>
      options.input
        ? { status: 1, stderr: "Cannot find package 'luxon'" }
        : successfulRun(command, args, options),
    );

    expect(() => bootstrapWorktree({ root: checkout(), run })).toThrow(
      "Cannot find package 'luxon'",
    );
    expect(existsSync(run.mock.calls[1][2].env.SHEAVLY_HOOK_STATE_DIR)).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects a guard decision that would block the user, even with exit code zero', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '{"continue":false,"user_message":"blocked"}' }));

    expect(() => verifyWorktree({ root: checkout(), run })).toThrow('blocked');
  });

  it('does not skip missing lint tools', () => {
    const run = vi.fn((command, args, options) =>
      path.basename(command) === 'eslint'
        ? { status: null, error: new Error('eslint missing') }
        : successfulRun(command, args, options),
    );

    expect(() => verifyWorktree({ root: checkout(), run })).toThrow('eslint missing');
  });

  it('verifies the real installed checkout without invoking installation', () => {
    expect(() => verifyWorktree({ root: REPO_ROOT })).not.toThrow();
  });

  it('keeps the session-move instruction after successful bootstrap in the start workflow', () => {
    const start = readFileSync(path.join(REPO_ROOT, '.agents/skills/git/start.md'), 'utf8');

    expect(start).toContain('node scripts/bootstrap-worktree.mjs <worktree-path>');
    expect(start).toMatch(/Only after it exits successfully[\s\S]*session_move/);
    expect(start).toContain('keep the session in the');
  });
});
