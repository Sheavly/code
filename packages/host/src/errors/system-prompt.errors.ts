import { BASE_INSTRUCTIONS_SECTION } from '@sheavly/extension/instructions/instructions.constants';
import type { InvalidOmitProblem } from '../instructions/system-prompt.types.js';

/**
 * `SystemPrompt.contribute` was called a second time. The host composes once, after every
 * extension has activated; a later contribution would silently drop the first, so it is refused.
 */
export class SystemPromptAlreadyContributedError extends Error {
  override name = 'SystemPromptAlreadyContributedError';

  constructor() {
    super(
      'The system prompt already took what the extensions contributed: contribute is called once, after every extension has activated',
    );
  }
}

/**
 * An extension holds `system-prompt:replace` and contributes a replacement base, but the app passed
 * its own `baseInstructions`. The app wins, and the replacement is refused loudly rather than
 * dropped, so nobody believes the extension's base is in use.
 */
export class BaseInstructionsConflictError extends Error {
  override name = 'BaseInstructionsConflictError';
  readonly extension: string;

  constructor(params: { extension: string }) {
    const { extension } = params;

    super(
      `Extension "${extension}" contributes a replacement base prompt, but the app passed its own baseInstructions, which wins: drop one of them, or list "${BASE_INSTRUCTIONS_SECTION}" in omitInstructionSections to leave the replacement out`,
    );
    this.extension = extension;
  }
}

/**
 * The app's `omitInstructionSections` is not an array of non-blank strings (`undefined` means
 * none). Refused before anything else, so a string is never read as its characters and a typo of
 * the type fails loudly instead of omitting nothing or something else.
 */
export class InvalidOmitInstructionSectionsError extends Error {
  override name = 'InvalidOmitInstructionSectionsError';
  readonly detail: InvalidOmitProblem;

  constructor(detail: InvalidOmitProblem) {
    const wrong =
      detail.problem === 'not-an-array'
        ? `got ${detail.received}`
        : `entry ${detail.index} is ${detail.problem === 'blank' ? 'blank' : `not a string (got ${detail.received})`}`;

    super(`omitInstructionSections must be an array of non-blank strings: ${wrong}`);
    this.detail = detail;
  }
}

/**
 * The app's `omitInstructionSections` names a section no extension contributed (or the reserved
 * replacement-base name when none replaced the base). Refused loudly: a typo must not silently
 * leave the text in the prompt.
 */
export class UnknownInstructionSectionError extends Error {
  override name = 'UnknownInstructionSectionError';
  readonly sectionName: string;
  readonly available: string[];

  constructor(params: { name: string; available: string[] }) {
    const { name, available } = params;
    const known = available.length > 0 ? available.join(', ') : 'none';

    super(
      `omitInstructionSections names "${name}", which no extension contributed. Available: ${known}`,
    );
    this.sectionName = name;
    this.available = available;
  }
}
