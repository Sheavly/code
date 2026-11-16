import { PassThrough } from 'node:stream';
import { MAX_OUTPUT_CHARS } from './process.constants.js';
import { withDeadline } from './deadline.helper.js';
import { OutputBuffer } from '@sheavly/runtime/output/output.service';
import type {
  Connector,
  ProcessParams,
  ProcessResult,
  ScriptParams,
  ScriptStep,
} from './process.types.js';

type RunProcess = (params: ProcessParams) => Promise<ProcessResult>;
type ListConnector = Exclude<Connector, '|'>;
/** Steps joined by `|`, all running together, and what joins the next pipeline to them. */
type Pipeline = { stages: ScriptStep[]; next: ListConnector };

/** Splits steps at `&&`, `||` and `;`; the last pipeline's `next` is never used. */
function splitPipelines(steps: ScriptStep[]): Pipeline[] {
  const pipelines: Pipeline[] = [];
  let stages: ScriptStep[] = [];

  for (const step of steps) {
    stages.push(step);

    if (step.joinedBy === '|') continue;
    pipelines.push({ stages, next: step.joinedBy ?? ';' });
    stages = [];
  }

  return pipelines;
}

/**
 * Whether the pipeline after `connector` runs, given the exit code of the last pipeline that did
 * run. A pipeline that was skipped leaves that status as it was, so in `a && b || c` a failing
 * `a` skips `b` and still runs `c`, as in a shell.
 */
function shouldRun(params: { connector: ListConnector; exitCode: number | null }): boolean {
  const { connector, exitCode } = params;

  if (connector === ';') return true;

  return connector === '&&' ? exitCode === 0 : exitCode !== 0;
}

type PipelineOptions = Omit<ProcessParams, 'file' | 'args' | 'shell' | 'input' | 'stdoutTo'>;

/**
 * Starts every stage at once, each reading the one before it. If any stage fails to run, the rest
 * are stopped and waited for, so nothing of the pipeline is still running when this returns or
 * throws; the first failure is thrown. The exit code is the last stage's, as in a shell without
 * `pipefail`, except that a pipeline whose `caller` signal aborted while it ran has none (`null`).
 */
async function runPipeline(params: {
  stages: ScriptStep[];
  run: RunProcess;
  options: PipelineOptions;
  /** The caller's own signal, without the script's timeout: only its abort is a cancel. */
  caller: AbortSignal;
}): Promise<number | null> {
  const { stages, run, options, caller } = params;
  const failure = new AbortController();
  const signal = AbortSignal.any([options.signal, failure.signal]);
  const running: Promise<ProcessResult>[] = [];
  let input: PassThrough | undefined;

  for (const [index, stage] of stages.entries()) {
    const [file, ...args] = stage.argv;
    const pipe = index === stages.length - 1 ? undefined : new PassThrough();
    const started = run({
      ...options,
      signal,
      file,
      args,
      shell: false,
      ...(input && { input }),
      ...(pipe && { stdoutTo: pipe }),
    });

    running.push(
      started.catch((caughtError: unknown) => {
        failure.abort();
        throw caughtError;
      }),
    );
    input = pipe;
  }

  const settled = await Promise.allSettled(running);
  const results: ProcessResult[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') throw outcome.reason as Error;
    results.push(outcome.value);
  }

  // The last stage can exit 0 before the abort kills an earlier one: that is not a finished run.
  // Read once every stage has stopped, so a pipeline that finished before the abort keeps its code.
  if (caller.aborted) return null;

  return results.at(-1)?.exitCode ?? null;
}

/**
 * Runs `steps` the way a shell runs a line of commands, without a shell: `a | b` feeds a's
 * output to b while both run, `a && b` runs b if a succeeded, `a || b` if it failed, `a ; b`
 * either way. The result is the last pipeline's exit code (`null` for a pipeline that aborting
 * `signal` stopped) and the output of every command in the order it arrived. The result keeps bounded first/last lines, while every original chunk still
 * streams to `onOutput` and pipes. `timeoutMs` covers the whole script:
 * past it the running commands are killed, nothing more starts, and the result says it timed out.
 * A command that cannot start, or aborting `signal`, throws what `run` throws, after every
 * command of that pipeline has stopped.
 */
export async function runScript(params: {
  run: RunProcess;
  script: ScriptParams;
}): Promise<ProcessResult> {
  const { run, script } = params;
  const { steps, timeoutMs, onOutput, ...rest } = script;
  const { signal, timedOut } = withDeadline({ signal: rest.signal, timeoutMs });
  const output = new OutputBuffer({ maxChars: MAX_OUTPUT_CHARS });
  let exitCode: number | null = null;
  let connector: ListConnector = ';';

  const options: PipelineOptions = {
    ...rest,
    signal,
    onOutput: (chunk) => {
      output.push(chunk);
      onOutput?.(chunk);
    },
  };

  for (const { stages, next } of splitPipelines(steps)) {
    // A caller's abort is not a stop here: `run` throws for it, as it always has.
    if (timedOut()) break;

    if (shouldRun({ connector, exitCode })) {
      exitCode = await runPipeline({ stages, run, options, caller: rest.signal });
    }

    connector = next;
  }

  return { exitCode, output: output.text, timedOut: timedOut() };
}
