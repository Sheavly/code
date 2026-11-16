/**
 * What a Ctrl+C found: a prompt (or run) to stop, one already stopping, or nothing running.
 * `ChatSession.stop` and `abortingStop` return it.
 */
export type StopResult = 'stopped' | 'stopping' | 'idle';

/** Where Ctrl+C comes from: `process`, or a readline interface that has taken over the key. */
export type CtrlCSource = {
  on: (event: 'SIGINT', listener: () => void) => unknown;
  off: (event: 'SIGINT', listener: () => void) => unknown;
};
