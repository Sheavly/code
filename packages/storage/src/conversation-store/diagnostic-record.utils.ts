import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { DiagnosticRecord } from './diagnostic-record.types.js';
import { redactDiagnosticText } from '@sheavly/core/text/diagnostic-text.utils';

/** Selects failure metadata, not prompts, tool inputs, successful outputs or reasoning. */
export function diagnosticRecord(params: {
  entry: StreamEntry;
  conversationId: DiagnosticRecord['conversationId'];
  modelId: DiagnosticRecord['modelId'];
}): DiagnosticRecord | undefined {
  const { entry, conversationId, modelId } = params;

  if (entry.kind !== 'event') return undefined;

  const base = {
    at: entry.at,
    seq: entry.seq,
    sessionId: entry.sessionId,
    ...(entry.messageId && { messageId: entry.messageId }),
    ...(conversationId && { conversationId }),
    ...(modelId && { modelId }),
  };
  const { event } = entry;

  if (event.type === 'run_failed') {
    return {
      ...base,
      type: 'run_failed',
      error: redactDiagnosticText(event.error),
      ...(event.details && { details: event.details }),
    };
  }

  if (event.type === 'hook_failed') {
    return {
      ...base,
      type: 'hook_failed',
      error: redactDiagnosticText(event.error),
      hook: event.hook,
      handler: event.handler,
    };
  }

  if (event.type === 'tool_result' && event.message.role === 'tool' && event.message.isError) {
    return {
      ...base,
      type: 'tool_failed',
      error: redactDiagnosticText(event.message.content),
      toolCallId: event.call.id,
      toolName: event.call.name,
    };
  }

  return undefined;
}
