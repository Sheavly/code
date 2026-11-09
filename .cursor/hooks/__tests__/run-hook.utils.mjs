// Test-only: runs a hook script the way Cursor does, JSON on stdin and JSON back on stdout.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '..');

/** Runs `script` in `cwd` with `input`, its chat state in `stateDir`; returns its response. */
export function runHook(params) {
  const { script, cwd, input, stateDir, hooksRoot = HOOKS } = params;
  const run = spawnSync(process.execPath, [path.join(hooksRoot, script)], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, SHEAVLY_HOOK_STATE_DIR: stateDir },
  });

  if (run.status !== 0) {
    throw new Error(`Hook ${script} failed: ${run.error?.message ?? run.stderr}`);
  }

  return JSON.parse(run.stdout);
}

/** Runs the postToolUse hook for an edit of `file` in `cwd`, in chat `chat`; returns its response. */
export function runEditHook(params) {
  const { cwd, file, chat = 'c1', stateDir } = params;

  return runHook({
    script: 'lint-edited-file.mjs',
    cwd,
    input: { conversation_id: chat, tool_input: { path: file } },
    stateDir,
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
