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
