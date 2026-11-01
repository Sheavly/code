// Test-only: runs a hook script the way Cursor does, JSON on stdin and JSON back on stdout.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '..');

/** Runs `script` in `cwd` with `input`, its chat state in `stateDir`; returns its response. */
export function runHook(params) {
  const { script, cwd, input, stateDir } = params;
  const run = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, SHEAVLY_HOOK_STATE_DIR: stateDir },
  });

  return JSON.parse(run.stdout);
}
