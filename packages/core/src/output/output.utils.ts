import type { OutputLog } from '@sheavly/protocol/output/output.types';
import { renderOutputReference } from './output.prompt.js';

/** A read or search result with the log's reference and completeness, as every store reports it. */
export function withLogState<T extends object>(params: {
  log: OutputLog;
  body: T;
}): T & Pick<OutputLog, 'ref' | 'status'> & { reason?: string } {
  const { log, body } = params;

  return {
    ref: log.ref,
    ...body,
    status: log.status,
    ...(log.reason !== undefined && { reason: log.reason }),
  };
}

/**
 * The reference lines for a task or command result: the log's reference and completeness, and,
 * when `shown` (the preview exactly as the model is given it) holds less than the log, where to
 * read the rest. `[]` when no output is captured.
 */
export function outputReferenceLines(params: {
  log: OutputLog | undefined;
  shown: string;
}): string[] {
  const { log, shown } = params;

  if (!log) return [];

  return renderOutputReference({
    ref: log.ref,
    bytes: String(log.bytes),
    state: log.status,
    reason: log.reason,
    truncated: log.bytes > Buffer.byteLength(shown),
  });
}
