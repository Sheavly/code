type ProcessOptions = {
  cwd: string;
  /** Run `file` through /bin/sh (then `args` should be empty). */
  shell: boolean;
  signal: AbortSignal;
  /** No timeout when omitted. */
  timeoutMs?: number;
  /** Streams output as it arrives, in addition to the returned copy. */
  onOutput?: (chunk: string) => void;
};

/** What to run, and how. */
export type ProcessParams = ProcessOptions & { file: string; args: string[] };

export type ProcessResult = {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};
