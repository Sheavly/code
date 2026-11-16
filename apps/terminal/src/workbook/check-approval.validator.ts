import { z } from 'zod';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { commandBase } from '@sheavly/coding/run-command/command-base.utils';
import { parseCommand } from '@sheavly/coding/run-command/allow-list.utils';
import { WorkbookCheckError } from './check.errors.js';

/** An explicit base, not an invocation, executable path, wildcard or permission-store entry. */
const approvedCommandSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (!/^[\w.-]+(?: [\w.-]+)*$/.test(value)) return false;

    const parsed = parseCommand(value);

    return (
      parsed.ok &&
      parsed.steps.length === 1 &&
      commandBase(parsed.steps[0]?.argv ?? []).join(' ') === value
    );
  }, 'expected a base command (for example node or npm run test), not arguments or a path');

/** Removes only approval flag/value pairs, preserving prompt names even when equal to a base. */
export function parseCheckApprovalOptions(argv: string[]): {
  argv: string[];
  approvedCommands: string[];
} {
  const remaining: string[] = [];
  const approved: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const word = argv[index] ?? '';

    if (!word.startsWith('--approve-command')) {
      remaining.push(word);
      continue;
    }

    if (
      argv[0] !== 'check' ||
      word !== '--approve-command' ||
      !argv[index + 1] ||
      argv[index + 1]?.startsWith('--')
    ) {
      throw new WorkbookCheckError({
        message: 'Use check --approve-command <base-command> (repeatable).',
      });
    }

    approved.push(argv[index + 1] ?? '');
    index++;
  }

  if (
    argv[0] === 'check' &&
    remaining.some(
      (word) => word.startsWith('--') && !['--all', '--model', '--mode'].includes(word),
    )
  ) {
    throw new WorkbookCheckError({ message: 'Unknown workbook check flag.' });
  }

  const modelAt = remaining.indexOf('--model');

  if (argv[0] === 'check' && modelAt !== -1 && !remaining[modelAt + 1]?.trim()) {
    throw new WorkbookCheckError({ message: 'Use check --model <id|name>.' });
  }

  return { argv: remaining, approvedCommands: [...new Set(parseApprovedCommands(approved))] };
}

export function parseApprovedCommands(input: unknown): string[] {
  return parseOrThrow({
    schema: z.array(approvedCommandSchema),
    input,
    onInvalid: ({ details, error }) =>
      new WorkbookCheckError({
        message: `Invalid --approve-command: ${details}`,
        cause: error,
      }),
  });
}
