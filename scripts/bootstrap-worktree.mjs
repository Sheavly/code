import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWorktree } from './verify-worktree.mjs';

/** Installs the target checkout and verifies readiness. Never moves a session, even on failure. */
export function bootstrapWorktree(params) {
  const { root, run = spawnSync } = params;
  const target = realpathSync(root);
  const result = run('npm', ['ci'], {
    cwd: target,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 300_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0) {
    throw new Error(`npm ci failed in ${target}: ${result.error?.message ?? output}`);
  }

  verifyWorktree({ root: target, run });

  return { root: target, output };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [root, ...extra] = process.argv.slice(2);

  try {
    if (!root || extra.length > 0) {
      throw new Error('Usage: node scripts/bootstrap-worktree.mjs <worktree-path>');
    }

    const ready = bootstrapWorktree({ root });

    console.log(ready.output.trim());
    console.log(`Worktree ready: ${ready.root}. It is safe to move the session there.`);
  } catch (caughtError) {
    console.error(
      `Worktree not ready. Keep the session in its original checkout.\n${caughtError.message}`,
    );
    process.exitCode = 1;
  }
}
