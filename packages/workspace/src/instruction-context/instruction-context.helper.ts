import type { BeforeTurnContext } from '@sheavly/core/hook/hook.types';
import {
  instructionContextOpening,
  renderInstructionContext,
} from './instruction-context.prompt.js';

/** Appends changed instructions without rewriting the prefix of signed model reasoning. */
export function appendInstructionContext(params: {
  context: BeforeTurnContext;
  name: string;
  instructions: string | undefined;
}): void {
  const { context, name, instructions } = params;
  const opening = instructionContextOpening(name);
  const content = renderInstructionContext({ name, instructions });
  const previous = context.messages.findLast(
    (message) => message.role === 'user' && message.content.startsWith(opening),
  );

  if (previous?.content === content || (!previous && !instructions)) return;

  context.addContext(content);
}
