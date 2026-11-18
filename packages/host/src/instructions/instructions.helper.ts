import { joinInstructions } from '@sheavly/extension/instructions/instructions.utils';
import { BASE_AGENT_INSTRUCTIONS } from './instructions.prompt.js';

/** Omission uses the generic core; an explicit empty base omits it. Blank sections are skipped. */
export function composeInstructions(params: {
  baseInstructions?: string | undefined;
  instructions?: string | undefined;
}): string {
  const { baseInstructions = BASE_AGENT_INSTRUCTIONS, instructions = '' } = params;

  return joinInstructions([baseInstructions, instructions]);
}
