import { composeSystemPrompt } from './system-prompt.utils.js';

/**
 * Omission uses the generic core; an explicit empty base omits it. Blank sections are skipped.
 * This is the prompt of a host whose extensions contribute no instructions.
 */
export function composeInstructions(params: {
  baseInstructions?: string | undefined;
  instructions?: string | undefined;
}): string {
  return composeSystemPrompt(params);
}
