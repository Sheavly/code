import type { InstructionContribution } from '@sheavly/extension/extension/extension.types';

/** What was wrong with the app's `omitInstructionSections`, in the terms its error reports. */
export type InvalidOmitProblem =
  | { problem: 'not-an-array'; received: string }
  | { problem: 'not-a-string'; index: number; received: string }
  | { problem: 'blank'; index: number };

/** What the extensions of a run contributed to the system prompt, as the extension host merged it. */
export type SystemPromptContribution = {
  /** The sections in activation order. */
  sections: readonly InstructionContribution[];
  /** The replacement base and the extension that holds it; none when no extension replaces it. */
  replacement?: { extension: string; text: string } | undefined;
};
