import type { InstructionContribution } from '@sheavly/extension/extension/extension.types';
import { BASE_INSTRUCTIONS_SECTION } from '@sheavly/extension/instructions/instructions.constants';
import {
  BaseInstructionsConflictError,
  SystemPromptAlreadyContributedError,
  UnknownInstructionSectionError,
} from '../errors/system-prompt.errors.js';
import type { SystemPromptContribution } from './system-prompt.types.js';
import { checkedOmitSections, composeSystemPrompt } from './system-prompt.utils.js';

/**
 * The run's system prompt, composed each time it is read from what is known by then. The harness
 * is built before any extension activates, and the app hands it the extensions' contributions once,
 * after every one of them has activated: while an extension's `activate` runs, the text is only the
 * base plus the app's own instructions, and a read made later (such as an agent's read when it
 * starts a sub-agent) sees the contributions. A host with no extension contributing instructions
 * reads exactly what `composeInstructions` returns.
 */
export class SystemPrompt {
  readonly #baseInstructions: string | undefined;
  readonly #instructions: string | undefined;
  #sections: readonly InstructionContribution[] = [];
  #replacement: string | undefined;
  readonly #omitted: ReadonlySet<string>;
  #contributed = false;

  /**
   * Throws an `InvalidOmitInstructionSectionsError` unless `omitInstructionSections` is
   * `undefined` or an array of non-blank strings.
   */
  constructor(params: {
    baseInstructions?: string | undefined;
    instructions?: string | undefined;
    omitInstructionSections?: readonly string[] | undefined;
  }) {
    // First, before anything else is held: this is the one place the app's option enters, and a
    // plain-JS caller can pass any value, so the declared type is not trusted.
    this.#omitted = checkedOmitSections(params.omitInstructionSections);
    this.#baseInstructions = params.baseInstructions;
    this.#instructions = params.instructions;
  }

  /**
   * Takes what the extensions contributed, once, after every extension has activated: for the app,
   * not for extensions. Each section is copied and frozen, so a later change by the caller shows
   * nowhere. The app's `omitInstructionSections` are dropped from it, and an omitted replacement
   * is not applied and conflicts with nothing. Throws an `UnknownInstructionSectionError` for an
   * omitted name no contributed section (or replacement) has, a `BaseInstructionsConflictError`
   * naming the extension when a replacement base that is not omitted meets the app's own
   * `baseInstructions` (in both cases nothing is taken and the call does not count as the one
   * call), and a `SystemPromptAlreadyContributedError` on any call after one that took a
   * contribution.
   */
  contribute(contribution: SystemPromptContribution): void {
    const { sections, replacement } = contribution;

    if (this.#contributed) throw new SystemPromptAlreadyContributedError();

    this.#assertOmittedAreKnown({ sections, hasReplacement: replacement !== undefined });

    const replaced = this.#omitted.has(BASE_INSTRUCTIONS_SECTION) ? undefined : replacement;

    if (replaced && this.#baseInstructions !== undefined) {
      throw new BaseInstructionsConflictError({ extension: replaced.extension });
    }

    this.#sections = Object.freeze(
      sections
        .filter(({ name }) => !this.#omitted.has(name))
        .map(({ name, text }) => Object.freeze({ name, text })),
    );
    this.#replacement = replaced?.text;
    this.#contributed = true;
  }

  #assertOmittedAreKnown(params: {
    sections: SystemPromptContribution['sections'];
    hasReplacement: boolean;
  }): void {
    const { sections, hasReplacement } = params;
    const available = new Set(sections.map(({ name }) => name));

    if (hasReplacement) available.add(BASE_INSTRUCTIONS_SECTION);

    for (const name of this.#omitted) {
      if (!available.has(name)) {
        throw new UnknownInstructionSectionError({ name, available: [...available].sort() });
      }
    }
  }

  /** The prompt as of now. */
  get text(): string {
    return composeSystemPrompt({
      baseInstructions: this.#baseInstructions,
      replacement: this.#replacement,
      sections: this.#sections,
      instructions: this.#instructions,
    });
  }
}
