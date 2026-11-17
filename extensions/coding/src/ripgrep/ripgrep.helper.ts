import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import type { ProcessRunner } from '@sheavly/process/process/process.service';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import type { WorkingRoots } from '@sheavly/workspace/working-root/working-roots.service';
import { anchorToRoot } from '@sheavly/workspace/working-root/working-root.utils';
import { isInside } from '@sheavly/workspace/workspace/workspace.utils';
import { assertNotEnvFile, assertNotGitDir } from '../files/files.utils.js';
import { currentRoot } from '../files/working-root.helper.js';
import { GREP_TIMEOUT_MS, MAX_GREP_RAW_CHARS } from './ripgrep.constants.js';
import type { RipgrepRun } from './ripgrep.types.js';

/** `real` relative to the search folder; scratch stays absolute, as the workspace shows it. */
function relativeToSearchCwd(params: { workspace: Workspace; cwd: string; real: string }): string {
  const { workspace, cwd, real } = params;

  if (workspace.inScratch(real) && !isInside({ folder: cwd, target: real })) return real;

  return path.relative(cwd, real) || '.';
}

/**
 * Where a search runs and what it searches: `cwd` is the working root when one is set (else the
 * workspace root) and `searched` is the folder or file, relative to it. ripgrep applies its
 * excludes to what it walks, never to a root path it is given, so the path is checked here, by
 * name and after symlinks. Throws if it is outside the workspace, a `.env` file or inside `.git`.
 */
export async function resolveSearchRoot(params: {
  workspace: Workspace;
  workingRoots: WorkingRoots | undefined;
  requested: string;
}): Promise<{ searched: string; cwd: string }> {
  const { workspace, workingRoots, requested } = params;
  const root = await currentRoot(workingRoots);
  const cwd = root ?? workspace.root;

  assertNotEnvFile({ filePath: requested, requested, action: 'Searching' });
  assertNotGitDir({ relativePath: requested, requested, action: 'Searching' });
  const anchored = anchorToRoot({ requested, root });

  assertNotEnvFile({ filePath: anchored, requested, action: 'Searching' });
  const real = await workspace.resolveRead(anchored); // rejects escapes, follows symlinks
  const searched = relativeToSearchCwd({ workspace, cwd, real });

  assertNotEnvFile({ filePath: real, requested, action: 'Searching' });
  assertSearchOutsideGit({ workspace, requested, paths: { searched, real, cwd } });

  return { searched, cwd };
}

/**
 * Refuses a search that starts in or reaches `.git`. `searched` is relative to the working root,
 * so a root inside `.git` would hide it there: the workspace-relative path and the folder ripgrep
 * starts in are checked as well.
 */
function assertSearchOutsideGit(params: {
  workspace: Workspace;
  requested: string;
  paths: { searched: string; real: string; cwd: string };
}): void {
  const { workspace, requested, paths } = params;
  const action = 'Searching';

  assertNotGitDir({ relativePath: paths.searched, requested, action });
  assertNotGitDir({ relativePath: workspace.relative(paths.real), requested, action });
  assertNotGitDir({ relativePath: workspace.relative(paths.cwd), requested, action });
}

/**
 * Runs ripgrep with its standard output going to a collector of its own, not the runner's
 * output buffer: that one keeps only a head and a tail, which would break the records being
 * parsed. Past `MAX_GREP_RAW_CHARS` the collector closes, and the runner stops ripgrep as it
 * would a closed pipe.
 */
export async function runRipgrep(params: {
  processes: ProcessRunner;
  file: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
}): Promise<RipgrepRun> {
  const { processes, file, args, cwd, signal } = params;
  const decoder = new StringDecoder('utf8');
  let stdout = '';
  let cut = false;
  const collector = new Writable({
    write(chunk: Buffer, _encoding, done) {
      stdout += decoder.write(chunk);
      done();

      if (stdout.length <= MAX_GREP_RAW_CHARS) return;

      cut = true;
      stdout = stdout.slice(0, MAX_GREP_RAW_CHARS);
      this.destroy();
    },
  });

  const result = await processes.run({
    file,
    args,
    cwd,
    shell: false,
    signal,
    timeoutMs: GREP_TIMEOUT_MS,
    stdoutTo: collector,
  });

  // A multibyte character cut off at the end of the output is flushed, not lost.
  if (!cut) stdout += decoder.end();

  return {
    stdout,
    stderr: result.output,
    exitCode: result.exitCode,
    cut,
    timedOut: result.timedOut,
  };
}

/**
 * Throws unless ripgrep ran to the end, or was stopped on purpose for printing too much. Exit 0
 * (matches) and 1 (none) are results. Exit 2 is an error, but ripgrep also uses it when it only
 * skipped a file it could not read, so with output it is a partial result the caller reports.
 * Anything else (a signal, no exit code) is a failure, never "no matches".
 */
export function assertRanToTheEnd(run: RipgrepRun): void {
  if (run.timedOut) {
    throw new ToolCallError({
      reason: 'invalid_input',
      message: `The search took longer than ${GREP_TIMEOUT_MS / 1000}s and was stopped. Narrow it with a smaller path or a tighter pattern.`,
    });
  }

  if (run.cut || run.exitCode === 0 || run.exitCode === 1) return;

  if (run.exitCode === 2 && run.stdout !== '') return;

  throw new ToolCallError({
    reason: 'invalid_input',
    message: run.stderr.trim() || `ripgrep failed (exit ${run.exitCode ?? 'by signal'}).`,
  });
}
