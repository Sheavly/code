import type { ErrorDetails } from '@sheavly/protocol/event/event.types';
import { errorCode } from './errors.utils.js';
import { redactDiagnosticText } from '@sheavly/core/text/diagnostic-text.utils';

function metadata(error: Error) {
  const code = errorCode(error);
  const reason: unknown = Reflect.get(error, 'reason');

  return {
    name: error.name,
    ...(code && { code }),
    ...(typeof reason === 'string' && { reason }),
  };
}

/** Captures bounded causes and a stack, never arbitrary properties such as requests or headers. */
export function errorDetails(error: unknown): ErrorDetails {
  if (!(error instanceof Error)) return { name: 'UnknownError', causes: [] };

  const causes: ErrorDetails['causes'] = [];
  const seen = new Set<Error>([error]);
  let cause = error.cause;

  while (cause instanceof Error && causes.length < 4 && !seen.has(cause)) {
    seen.add(cause);
    causes.push({
      ...metadata(cause),
      message: redactDiagnosticText(cause.message).slice(0, 8192),
    });
    cause = cause.cause;
  }

  return {
    ...metadata(error),
    ...(error.stack && { stack: redactDiagnosticText(error.stack).slice(0, 16384) }),
    causes,
  };
}
