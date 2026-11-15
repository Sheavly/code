import path from 'node:path';
import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WorkspaceError } from '../errors/workspace.errors.js';
import {
  MAX_CHUNKS_PER_FILE,
  MAX_HASH_LENGTH,
  MAX_PERSISTED_CHARS,
  MAX_PERSISTED_FILES,
} from './file-reads.constants.js';
import type { FileViews } from './file-reads.types.js';

/**
 * One kept view, with the states the service itself never makes refused: a whole-file read always
 * has its text, and a view never holds more pieces than the service keeps.
 */
const fileViewSchema = z
  .object({
    chunks: z.array(z.string()).max(MAX_CHUNKS_PER_FILE),
    whole: z.boolean(),
    hash: z.string().min(1).max(MAX_HASH_LENGTH),
  })
  .refine((view) => !view.whole || view.chunks.length > 0, 'a whole-file read has its text');

/**
 * The reads a conversation keeps: by absolute real path, what the main agent was shown of each
 * file. Bounded like what is written, so a damaged or oversized document is refused instead of
 * loaded whole.
 */
const fileViewsSchema = z
  .record(
    z.string().refine((file) => path.isAbsolute(file), 'must be an absolute path'),
    fileViewSchema,
  )
  .refine((views) => Object.keys(views).length <= MAX_PERSISTED_FILES, 'too many files')
  .refine(
    (views) =>
      Object.values(views).reduce(
        (total, view) => total + view.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
        0,
      ) <= MAX_PERSISTED_CHARS,
    'too much text',
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
