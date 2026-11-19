import { ExtensionInstructionError } from '../errors/instruction.errors.js';
import { requireGrant } from '../extension/grants.utils.js';
import type { Contributions, InstructionContribution } from '../extension/extension.types.js';
import {
  BASE_INSTRUCTIONS_SECTION,
  MAX_INSTRUCTION_CHARS,
  SYSTEM_PROMPT_EXTEND_GRANT,
  SYSTEM_PROMPT_REPLACE_GRANT,
} from '../instructions/instructions.constants.js';
import type { InstructionProblem } from '../instructions/instructions.types.js';
import type { ExtensionManifest } from '../manifest/manifest.types.js';

/**
 * Throws an `ExtensionUndeclaredError` (`use: 'grant'`) when `sections` is not empty and the
 * manifest's `grants` lacks `system-prompt:extend`. `sections` must be the one copy the host
 * checks and merges from, never a second read of the extension's own list: the grant is decided
 * on exactly what is held.
 */
export function assertMayExtendPrompt(params: {
  manifest: ExtensionManifest;
  sections: readonly unknown[];
}): void {
  const { manifest, sections } = params;

  if (sections.length === 0) return;

  requireGrant({
    extension: manifest.name,
    grants: manifest.grants,
    grant: SYSTEM_PROMPT_EXTEND_GRANT,
  });
}

/** What is wrong with `text` as prompt text, if anything. */
function problemWith(text: unknown): InstructionProblem | undefined {
  if (typeof text !== 'string') return 'not-text';

  if (text.trim() === '') return 'blank';

  if (text.length > MAX_INSTRUCTION_CHARS) return 'too-long';

  return undefined;
}

/** Throws an `ExtensionInstructionError` unless `text` is a non-blank string within the cap. */
function assertPromptText(params: { extension: string; section: string; text: unknown }): void {
  const { extension, section, text } = params;
  const problem = problemWith(text);

  if (problem !== undefined) throw new ExtensionInstructionError({ extension, section, problem });
}

/**
 * One section as the host will hold it: its name and text each read once, the name not the
 * reserved `BASE_INSTRUCTIONS_SECTION`, the text checked (a string, not blank, at most
 * `MAX_INSTRUCTION_CHARS`), and a frozen `{ name, text }` copy that nothing the extension keeps
 * can change. Throws an `ExtensionInstructionError` otherwise.
 */
export function checkedInstruction(params: {
  extension: string;
  section: InstructionContribution;
}): {
  name: string;
  item: InstructionContribution;
} {
  const { extension, section } = params;
  const { name, text } = section;

  if (name === BASE_INSTRUCTIONS_SECTION) {
    throw new ExtensionInstructionError({ extension, section: name, problem: 'reserved' });
  }

  assertPromptText({ extension, section: name, text });

  return { name, item: Object.freeze({ name, text }) };
}

/**
 * The replacement base as the host will hold it: read once, needing the `system-prompt:replace`
 * grant (an `ExtensionUndeclaredError` otherwise, independent of the extend grant) and checked
 * like a section's text (`undefined` when the extension contributes none). A string is
 * immutable, so the value read here is what is merged whatever the extension does later.
 */
export function checkedBaseInstructions(params: {
  manifest: ExtensionManifest;
  contributions: Contributions;
}): string | undefined {
  const { manifest, contributions } = params;
  // Read once: the grant check and the text check must see the same value, which is then merged.
  const text = contributions.baseInstructions;

  if (text === undefined) return undefined;

  requireGrant({
    extension: manifest.name,
    grants: manifest.grants,
    grant: SYSTEM_PROMPT_REPLACE_GRANT,
  });
  assertPromptText({ extension: manifest.name, section: BASE_INSTRUCTIONS_SECTION, text });

  return text;
}
