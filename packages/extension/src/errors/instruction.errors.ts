import { quotedName } from '../emit/quoted-name.utils.js';
import {
  BASE_INSTRUCTIONS_SECTION,
  INSTRUCTION_PROBLEM_MESSAGES,
  MAX_INSTRUCTION_CHARS,
  SYSTEM_PROMPT_REPLACE_GRANT,
} from '../instructions/instructions.constants.js';
import type { InstructionProblem } from '../instructions/instructions.types.js';

/** The rule a section broke, worded for the message. */
function ruleOf(problem: InstructionProblem): string {
  if (problem === 'reserved') {
    return `a section cannot be named "${BASE_INSTRUCTIONS_SECTION}": an app lists that name to omit a replacement base, which an extension contributes with ${SYSTEM_PROMPT_REPLACE_GRANT}, so pick another name`;
  }

  return `a section is a non-blank string of at most ${MAX_INSTRUCTION_CHARS} characters`;
}

/**
 * An extension contributed an instruction section whose `text` is not a string, is blank, or is
 * longer than `MAX_INSTRUCTION_CHARS`, or whose name is the reserved `BASE_INSTRUCTIONS_SECTION`.
 * Names the extension, the section and the rule; the activation fails, so none of its sections
 * reach the system prompt.
 */
export class ExtensionInstructionError extends Error {
  override name = 'ExtensionInstructionError';
  readonly extension: string;
  readonly section: string;
  readonly problem: InstructionProblem;

  constructor(params: { extension: string; section: string; problem: InstructionProblem }) {
    const { extension, section, problem } = params;

    super(
      `Extension ${extension} contributes the instruction section ${quotedName(section)}, but ${INSTRUCTION_PROBLEM_MESSAGES[problem]}: ${ruleOf(problem)}.`,
    );
    this.extension = extension;
    this.section = section;
    this.problem = problem;
  }
}
