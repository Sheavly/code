import type { Readable, Writable } from 'node:stream';

type ProcessOptions = {
  cwd: string;
  /** Run `file` through /bin/sh (then `args` should be empty). */
  shell: boolean;
  signal: AbortSignal;
  /** Added to the (secret-scrubbed) env, overriding what the harness inherited. */
  env?: Readonly<Record<string, string>>;
  /** No timeout when omitted. */
  timeoutMs?: number;
  /** Streams output as it arrives, in addition to the returned copy. */
  onOutput?: (chunk: string) => void;
  /**
   * What the process reads as its standard input. The runner closes it when the process exits, so
   * whatever feeds it stops at once, as a shell's pipe does. Without it the process reads nothing.
   */
  input?: Readable;
  /**
   * Where the process's standard output goes instead of `output` and `onOutput` (standard error
   * stays in both). Closing it stops the process's output, as a shell's closed pipe does.
   */
  stdoutTo?: Writable;
};

/** What to run, and how. */
export type ProcessParams = ProcessOptions & { file: string; args: string[] };

export type ProcessResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};

/** How one command of a script is joined to the next: a pipe, `&&`, `||` or `;`. */
export type Connector = '|' | '&&' | '||' | ';';

/** One command of a script: its program and arguments, and what joins it to the next, if any. */
export type ScriptStep = { argv: [string, ...string[]]; joinedBy?: Connector };

/** Commands to run as a shell would run a line of them, without a shell. */
export type ScriptParams = Omit<ProcessParams, 'file' | 'args' | 'shell' | 'input' | 'stdoutTo'> & {
  steps: [ScriptStep, ...ScriptStep[]];
};
