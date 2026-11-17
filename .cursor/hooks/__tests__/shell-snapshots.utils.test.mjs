import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveSnapshots, SNAPSHOT_TTL_MS, snapshotBefore } from '../shell-snapshots.utils.mjs';
import { runHook } from './run-hook.utils.mjs';

describe('liveSnapshots', () => {
  const snapshots = {
    recent: { takenAt: 1000 },
    old: { takenAt: 1000 - SNAPSHOT_TTL_MS - 1 },
    untimed: { files: {} },
  };

  it('drops what is older than the TTL and keeps what cannot be aged', () => {
    expect(Object.keys(liveSnapshots({ snapshots, now: 1000 }))).toEqual(['recent', 'untimed']);
  });

  it('reads no snapshot of a command whose entry expired', () => {
    expect(snapshotBefore({ snapshots, command: 'old', now: 1000 })).toBeUndefined();
    expect(snapshotBefore({ snapshots, command: 'recent', now: 1000 })).toEqual({ takenAt: 1000 });
    expect(snapshotBefore({ snapshots: undefined, command: 'x', now: 1000 })).toBeUndefined();
  });
});

describe('a command that crashed before its after-hook', () => {
  const command = 'echo x | tee a.ts';
  const crashedAt = 1_000_000;
  const later = crashedAt + SNAPSHOT_TTL_MS + 1;
  let repo = '';
  let stateDir = '';

  const hook = (script, input, now) =>
    runHook({
      script,
      cwd: repo,
      stateDir,
      input: { conversation_id: 'c1', cwd: repo, ...input },
      now,
    });

  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'snapshots-repo-'));
    stateDir = mkdtempSync(path.join(os.tmpdir(), 'snapshots-state-'));
    writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    const identity = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['add', '.'],
      [...identity, 'commit', '-qm', 'x'],
    ]) {
      spawnSync('git', args, { cwd: repo });
    }
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('leaves no snapshot behind once the next command is guarded', () => {
    hook('guard-shell-commands.mjs', { command }, crashedAt);
    hook('guard-shell-commands.mjs', { command: 'echo ok' }, later);

    const state = JSON.parse(readFileSync(path.join(stateDir, 'c1.json'), 'utf8'));

    expect(Object.keys(state.shellSnapshots)).toEqual(['echo ok']);
  });

  it('is not what a later run of the command is compared against', () => {
    hook('guard-shell-commands.mjs', { command }, crashedAt);
    writeFileSync(path.join(repo, 'a.ts'), 'changed since the crash');

    const after = hook('record-shell-writes.mjs', { tool_input: { command } }, later);

    expect(after).toEqual({});
  });

  it.each([
    ['one that expired', true],
    ['none kept at all', false],
  ])('is not skipped by the gate with %s: the chat edited without a file list', (_, kept) => {
    if (kept) hook('guard-shell-commands.mjs', { command }, crashedAt);
    hook('record-shell-writes.mjs', { tool_input: { command } }, later);

    const state = JSON.parse(readFileSync(path.join(stateDir, 'c1.json'), 'utf8'));

    expect(state).toMatchObject({ editedProjectSource: true, editedFilesComplete: false });
    expect(state.shellSnapshots).toEqual({});
  });
});
