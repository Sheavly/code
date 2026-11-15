import path from 'node:path';
import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WorkspaceError } from '../errors/workspace.errors.js';

/**
 * What `shell.json` holds that the working root owns: the agents' working root, when one is set.
 * The document is shared (the main agent's file reads live in it too), so another owner's keys are
 * stripped here on purpose, never rejected: do not make this schema strict, or a conversation
 * with kept reads would lose its working root.
 */
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
