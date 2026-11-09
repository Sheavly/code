import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function requireSuccess(params) {
  const { result, command } = params;

  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? `${result.stdout ?? ''}${result.stderr ?? ''}`}`,
    );
  }
}

function probeGuard(params) {
  const { root, entry, input, decision, stateDir, run } = params;

  if (!entry.command || entry.failClosed !== true) {
    throw new Error('Worktree guards must have commands and failClosed: true');
  }

  const result = run(entry.command, [], {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: (entry.timeout ?? 10) * 1000,
    input: JSON.stringify(input),
    env: { ...process.env, SHEAVLY_HOOK_STATE_DIR: stateDir },
  });

  requireSuccess({ result, command: entry.command });
  const response = JSON.parse(result.stdout);

  if (response[decision.key] !== decision.value) {
    throw new Error(`${entry.command} rejected its readiness probe: ${JSON.stringify(response)}`);
  }
}

function probeGuards(params) {
  const { root, run, stateDir } = params;
  const { hooks } = JSON.parse(readFileSync(path.join(root, '.cursor/hooks.json'), 'utf8'));
  const input = {
    conversation_id: 'worktree-readiness',
    workspace_roots: [root],
    cwd: root,
    prompt: 'NO-ISSUE verify worktree readiness',
    command: 'npm ci',
  };
  const probes = [
    { event: 'beforeSubmitPrompt', decision: { key: 'continue', value: true } },
    { event: 'beforeShellExecution', decision: { key: 'permission', value: 'allow' } },
  ];

  for (const { event, decision } of probes) {
    if (!hooks?.[event]?.length) throw new Error(`Missing ${event} guards`);

    for (const entry of hooks[event]) {
      probeGuard({ root, entry, input, decision, stateDir, run });
    }
  }
}

/** Runs configured guards with isolated state and checks the installed quality-tool executables. */
export function verifyWorktree(params) {
  const { root, run = spawnSync } = params;
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'worktree-readiness-'));

  try {
    probeGuards({ root, run, stateDir });

    for (const tool of ['prettier', 'eslint', 'turbo', 'knip', 'jscpd', 'vitest', 'tsc']) {
      const command = path.join(root, 'node_modules/.bin', tool);
      const result = run(command, ['--version'], { cwd: root, encoding: 'utf8', timeout: 30_000 });

      requireSuccess({ result, command });
    }
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}
