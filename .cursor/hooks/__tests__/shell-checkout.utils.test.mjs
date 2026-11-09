import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandsInCheckout } from '../shell-checkout.utils.mjs';
import { shellGuardFailure } from '../shell-guard-stop.utils.mjs';

let base;
let project;
let worktree;
let nested;
let alias;

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'shell-checkout-'));
  project = path.join(base, 'project');
  worktree = path.join(base, 'worktree');
  nested = path.join(project, 'nested');
  alias = path.join(base, 'alias');
  mkdirSync(nested, { recursive: true });

  for (const args of [
    ['init', '--quiet', '--initial-branch=main'],
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'initial',
    ],
    ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD'],
  ]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });

    expect(result.status, result.stderr).toBe(0);
  }

  symlinkSync(project, alias);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const finding = (fields = {}) => ({
  command: 'node scripts/bootstrap-worktree.mjs /new/worktree',
  cwd: project,
  files: ['a.ts'],
  ...fields,
});

describe('shell findings belong to a checkout', () => {
  it('keeps an explicit snapshot root even when execution cwd is another worktree', () => {
    const entry = finding({ projectRoot: project, cwd: worktree });

    expect(commandsInCheckout({ commands: [entry], projectRoot: project })).toEqual([entry]);
    expect(commandsInCheckout({ commands: [entry], projectRoot: worktree })).toEqual([]);
  });

  it('canonicalizes explicit snapshot roots without consulting execution cwd', () => {
    const commands = [
      finding({ projectRoot: project, cwd: nested }),
      finding({ projectRoot: alias, cwd: worktree }),
    ];

    expect(commandsInCheckout({ commands, projectRoot: project })).toEqual(commands);
    expect(commandsInCheckout({ commands, projectRoot: alias })).toEqual(commands);
    expect(commandsInCheckout({ commands, projectRoot: worktree })).toEqual([]);
  });

  it('never guesses a legacy snapshot root from a valid execution directory', async () => {
    const commands = [
      finding({ cwd: worktree }),
      finding({ cwd: nested }),
      finding({ cwd: alias }),
    ];
    const state = { unguardedCommands: commands };
    const othersEditedSince = () => new Set();

    expect(commandsInCheckout({ commands, projectRoot: project })).toEqual(commands);
    expect(commandsInCheckout({ commands, projectRoot: worktree })).toEqual(commands);
    expect(await shellGuardFailure({ state, projectRoot: project, othersEditedSince })).toContain(
      'DENIED_CASES lacks it',
    );
    expect(await shellGuardFailure({ state, projectRoot: worktree, othersEditedSince })).toContain(
      'DENIED_CASES lacks it',
    );
  });

  it('does not discard records without verifiable checkout information', () => {
    const commands = [
      finding({ cwd: undefined }),
      finding({ cwd: 'relative' }),
      finding({ cwd: path.join(base, 'gone') }),
      finding({ projectRoot: path.join(base, 'gone'), cwd: worktree }),
      finding({ projectRoot: 'relative', cwd: worktree }),
    ];

    expect(commandsInCheckout({ commands, projectRoot: project })).toEqual(commands);
    expect(commandsInCheckout({ commands, projectRoot: path.join(base, 'gone') })).toEqual(
      commands,
    );
  });

  it('stops checking the original checkout after a session moves, without clearing its record', async () => {
    const state = { unguardedCommands: [finding({ projectRoot: project })] };
    const params = { state, othersEditedSince: () => new Set() };

    expect(await shellGuardFailure({ ...params, projectRoot: worktree })).toBeNull();
    expect(await shellGuardFailure({ ...params, projectRoot: project })).toContain(
      'DENIED_CASES lacks it',
    );
    expect(state.unguardedCommands).toHaveLength(1);
  });

  it('still reports findings in this checkout and unknown legacy records', async () => {
    const state = { unguardedCommands: [finding({ cwd: undefined })] };

    expect(await shellGuardFailure({ state, projectRoot: worktree })).toContain(
      'the guard still allows it',
    );
  });
});
