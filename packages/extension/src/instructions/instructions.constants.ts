import type { InstructionProblem } from './instructions.types.js';

/**
 * The longest `text` one contributed instruction section, or a replacement base, may hold, in
 * characters (UTF-16 code units, as `String.length` counts them). A longer one fails its
 * extension's activation.
 */
export const MAX_INSTRUCTION_CHARS = 4000;

/**
 * What an error message calls a replacement base, which has no name of its own, and what an app
 * lists in `omitInstructionSections` to leave an extension's replacement out. Reserved for that:
 * no section may take this name, or omitting it could not tell the section from the replacement.
 */
export const BASE_INSTRUCTIONS_SECTION = 'baseInstructions';

/** How an error message words each problem with a section. */
export const INSTRUCTION_PROBLEM_MESSAGES: Record<InstructionProblem, string> = {
  'not-text': 'its text is not a string',
  blank: 'its text is empty or blank',
  'too-long': 'its text is longer than the cap',
  reserved: 'its name is reserved for a replacement base',
};

/**
 * The grant an extension's manifest lists to contribute instruction sections. The host offers it
 * itself, so it needs no service; a manifest may list it whether or not it contributes any.
 */
export const SYSTEM_PROMPT_EXTEND_GRANT = 'system-prompt:extend';

/**
 * The grant an extension's manifest lists to replace the generic base of the system prompt
 * (`baseInstructions`). Offered by the host itself like `system-prompt:extend`, and independent
 * of it: each grant covers only its own contribution.
 */
export const SYSTEM_PROMPT_REPLACE_GRANT = 'system-prompt:replace';

/** The grants the host offers itself, with no service behind them: every catalogue holds them. */
export const HOST_OFFERED_GRANTS: readonly string[] = [
  SYSTEM_PROMPT_EXTEND_GRANT,
  SYSTEM_PROMPT_REPLACE_GRANT,
];
