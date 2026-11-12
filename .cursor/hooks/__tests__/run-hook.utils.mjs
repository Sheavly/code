// Test-only: runs a hook script the way Cursor does, JSON on stdin and JSON back on stdout.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '..');
// Each case spawns a fresh node that recompiles the hook's modules; a shared compile cache (keyed
// by file content, so it can't serve stale code) cuts a start from about 0.24s to 0.16s. It lives
// in the checkout's ignored `node_modules`, not a fixed `/tmp` path another local user could seed.
const COMPILE_CACHE = path.resolve(HOOKS, '../../node_modules/.cache/sheavly-hook-compile-cache');

/** Runs a hook with isolated chat state; optional `now` pins its subprocess-only test clock. */
export function runHook(params) {
  const { script, cwd, input, stateDir, hooksRoot = HOOKS, now } = params;
  const clock = import.meta.resolve('./hook-clock.fake.mjs');
  const args = [...(now === undefined ? [] : ['--import', clock]), path.join(hooksRoot, script)];
  const run = spawnSync(process.execPath, args, {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_COMPILE_CACHE: COMPILE_CACHE,
      SHEAVLY_HOOK_STATE_DIR: stateDir,
      ...(now === undefined ? {} : { SHEAVLY_TEST_HOOK_NOW: String(now) }),
    },
  });

  if (run.status !== 0) {
    throw new Error(`Hook ${script} failed: ${run.error?.message ?? run.stderr}`);
  }

  return JSON.parse(run.stdout);
}

/** Runs the postToolUse hook for an edit of `file` in `cwd`, in chat `chat`; returns its response. */
export function runEditHook(params) {
  const { cwd, file, chat = 'c1', stateDir, now } = params;

  return runHook({
    script: 'lint-edited-file.mjs',
    cwd,
    input: { conversation_id: chat, tool_input: { path: file } },
    stateDir,
    now,
  });
}

/** Runs the stop hook in `cwd` for chat `chat` ending its turn with `status`; returns its response. */
export function runStopHook(params) {
  const { cwd, chat, status = 'completed', stateDir } = params;

  return runHook({
    script: 'check-on-stop.mjs',
    cwd,
    input: { conversation_id: chat, status },
    stateDir,
  });
}
