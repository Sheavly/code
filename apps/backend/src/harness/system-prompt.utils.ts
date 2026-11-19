import type { MergedContributions } from '@sheavly/extension/host/extension-host.types';
import type { SystemPromptContribution } from '@sheavly/host/instructions/system-prompt.types';

/**
 * What the host's system prompt takes from the activated extensions: their sections, and the
 * replacement base with the extension that holds it, if any.
 */
export function promptContribution(contributions: MergedContributions): SystemPromptContribution {
  const { instructions, baseInstructions, baseInstructionsBy } = contributions;

  if (baseInstructions === undefined || baseInstructionsBy === undefined) {
    return { sections: instructions };
  }

  return {
    sections: instructions,
    replacement: { extension: baseInstructionsBy, text: baseInstructions },
  };
}
