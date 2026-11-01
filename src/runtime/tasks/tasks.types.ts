export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** A snapshot of a task. Registry methods always return copies, never live objects. */
export type TaskInfo = {
  id: string;
  /** The tool call that started it, so the loop can tie the launch to its call. */
  callId?: string;
  command: string;
  description: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  /** Combined stdout/stderr so far (the most recent part, if it was long). */
  output: string;
  error?: string;
};

/** What to run in the background. */
export type StartTask = {
  command: string;
  description: string;
  callId?: string;
  /** Does the work. Must stop when `signal` aborts; reports output as it arrives. */
  run: (params: {
    signal: AbortSignal;
    onOutput: (chunk: string) => void;
  }) => Promise<{ exitCode: number | null }>;
};

/** How a task ended: its exit code, or the error that stopped it. */
export type TaskResult = { exitCode?: number | null; error?: string };
