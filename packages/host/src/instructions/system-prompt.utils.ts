import type { InstructionContribution } from '@sheavly/extension/extension/extension.types';
import { joinInstructions } from '@sheavly/extension/instructions/instructions.utils';
import { InvalidOmitInstructionSectionsError } from '../errors/system-prompt.errors.js';
import { BASE_AGENT_INSTRUCTIONS } from './instructions.prompt.js';

/** What a value is, for an error message: its type, with `null` and arrays told apart. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';

  return Array.isArray(value) ? 'an array' : typeof value;
}

/**
 * The names the app omits, as the one copy the prompt holds: `undefined` is none, anything else
 * must be an array whose every entry is a non-blank string. The array is read once (a getter or
 * proxy answers once), and that copy is both validated and used. Throws an
 * `InvalidOmitInstructionSectionsError` otherwise; a name is not trimmed, only a blank one refused.
 */
export function checkedOmitSections(value: unknown): ReadonlySet<string> {
  if (value === undefined) return new Set();

  if (!Array.isArray(value)) {
    throw new InvalidOmitInstructionSectionsError({
      problem: 'not-an-array',
      received: describeValue(value),
    });
  }

  const entries: unknown[] = value.slice();

  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== 'string') {
      throw new InvalidOmitInstructionSectionsError({
        problem: 'not-a-string',
        index,
        received: describeValue(entry),
      });
    }

    if (entry.trim() === '') {
      throw new InvalidOmitInstructionSectionsError({ problem: 'blank', index });
    }
  }

  return new Set(entries as string[]);
}

/**
 * The system prompt: a base, then the sections extensions contributed in activation order, then
 * the app's own `instructions`, each trimmed, blank ones dropped, joined by a blank line. The base
 * is the app's `baseInstructions` if it passed one (an empty string omits the core), else an
 * extension's `replacement`, else the generic base. With no sections and no replacement it is
 * exactly `composeInstructions`.
 */
export function composeSystemPrompt(params: {
  baseInstructions?: string | undefined;
  replacement?: string | undefined;
  sections?: readonly InstructionContribution[] | undefined;
  instructions?: string | undefined;
}): string {
  const { baseInstructions, replacement, sections = [], instructions = '' } = params;
  const base = baseInstructions ?? replacement ?? BASE_AGENT_INSTRUCTIONS;

  return joinInstructions([base, ...sections.map(({ text }) => text), instructions]);
}
