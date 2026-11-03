import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_CASES, DENIED_CASES } from '../shell-guard-cases.utils.mjs';
import { runHook } from './run-hook.utils.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');

const shell = (command) =>
  runHook({
    script: 'guard-shell-commands.mjs',
    cwd: ROOT,
    // No conversation id: nothing is snapshotted into the state dir.
    input: { command, cwd: ROOT },
    stateDir: os.tmpdir(),
  });

describe('guard-shell-commands', () => {
  it.each(DENIED_CASES)('denies an edit past the edit tools: %s', (command) => {
    const result = shell(command);

    expect(result.permission).toBe('deny');
    expect(result.agent_message).toMatch(/edit tools \(StrReplace\/Write\)/);
  });

  it.each(ALLOWED_CASES)('allows a read-only or out-of-project edit: %s', (command) => {
    expect(shell(command).permission).toBe('allow');
  });
});
