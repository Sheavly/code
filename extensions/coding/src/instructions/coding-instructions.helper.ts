import { joinInstructions } from '@sheavly/extension/instructions/instructions.utils';
import { CODING_INSTRUCTIONS } from './coding-instructions.prompt.js';

/**
 * The instructions of a coding run's host: coding's guidance, then the app's own `instructions`
 * (blank ones skipped). The app passes the result as `instructions` to `createHarness`, which
 * puts the generic base (or the app's `baseInstructions`) before it.
 */
export function composeCodingInstructions(params: { instructions?: string | undefined }): string {
  return joinInstructions([CODING_INSTRUCTIONS, params.instructions]);
}
