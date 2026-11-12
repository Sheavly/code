import path from 'node:path';
import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WorkspaceError } from '../errors/workspace.errors.js';

/** What `shell.json` holds: the agents' working root, when one is set. */
export const shellStateSchema = z.object({
  workingRoot: z
    .string()
    .refine((value) => path.isAbsolute(value), 'must be an absolute path')
    .optional(),
});

/** The typed `shell.json` contents, or a `WorkspaceError` saying what is wrong with them. */
export function parseShellState(input: unknown): z.infer<typeof shellStateSchema> {
  return parseOrThrow({
    schema: shellStateSchema,
    input,
    onInvalid: ({ details, error }) =>
      new WorkspaceError(`shell.json is not a valid shell state:\n${details}`, { cause: error }),
  });
}
