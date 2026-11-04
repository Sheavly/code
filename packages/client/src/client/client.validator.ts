import { serverErrorSchema } from '@sheavly/protocol/server/server.validator';
import type { ServerError } from '@sheavly/protocol/server/server.types';

/**
 * A refused answer's body as the protocol's `ServerError`, or undefined when it isn't one (a
 * proxy's HTML page, an empty body): the caller then reports the status alone.
 */
export function parseServerError(text: string): ServerError | undefined {
  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch (caughtError) {
    // Only a body that isn't JSON at all is expected here; it simply isn't a server error.
    if (caughtError instanceof SyntaxError) return undefined;
    throw caughtError;
  }

  const parsed = serverErrorSchema.safeParse(body);

  return parsed.success ? parsed.data : undefined;
}
