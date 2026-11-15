import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WorkspaceError } from '../errors/workspace.errors.js';
import type { FileViews } from './file-reads.types.js';

/** The reads a conversation keeps: by real path, what the main agent was shown of each file. */
const fileViewsSchema = z.record(
  z.string(),
  z.object({ chunks: z.array(z.string()), whole: z.boolean(), hash: z.string().min(1) }),
);

/** The stored reads, or a `WorkspaceError` saying what is wrong with them. */
export function parseFileViews(input: unknown): FileViews {
  return parseOrThrow({
    schema: fileViewsSchema,
    input,
    onInvalid: ({ details, error }) =>
      new WorkspaceError(`The stored file reads are not valid:\n${details}`, { cause: error }),
  });
}
