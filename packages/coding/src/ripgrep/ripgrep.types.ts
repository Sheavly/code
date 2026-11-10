/** What one ripgrep run produced. `cut` means it was stopped for printing too much. */
export type RipgrepRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cut: boolean;
  timedOut: boolean;
};
