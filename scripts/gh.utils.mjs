// `gh` for the scripts that read and change the repo's labels and issues. In CI the workflow
// passes GH_TOKEN and GH_REPO; locally `gh` uses its signed-in account and the checkout's remote.
import { spawnSync } from 'node:child_process';

/** Runs `gh` with `args` and returns its stdout; throws with its stderr when it fails. */
export function runGh(args) {
  const run = spawnSync('gh', args, { encoding: 'utf8' });

  if (run.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${run.stderr || run.error?.message}`);
  }

  return run.stdout;
}

/** `gh` output parsed as JSON (`--json …`), through `gh` (runGh, or a stand-in in tests). */
export function readGhJson(params) {
  const { gh, args } = params;

  return JSON.parse(gh(args));
}
