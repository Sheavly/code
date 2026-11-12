/** What bounds one capture: its stored bytes, the bytes waiting for the disk, the close wait. */
export type WriterLimits = {
  maxLogBytes: number;
  maxPendingBytes: number;
  closeTimeoutMs: number;
};

/**
 * What bounds a conversation's output store: one capture's limits, plus the bytes and the number
 * of logs the whole conversation may hold. Defaults are the protocol's; a test passes small ones.
 */
export type OutputStoreLimits = WriterLimits & { quotaBytes: number; maxLogs: number };
