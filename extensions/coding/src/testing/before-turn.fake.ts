import type { BeforeTurnContext } from '@sheavly/core/hook/hook.types';
import type { Message } from '@sheavly/protocol/message/message.types';

/**
 * Test-only: a `beforeTurn` context whose `addContext` fills `messages`, as the loop keeps them
 * in history, so a test can run a hook and read what it told the agent.
 */
export function fakeBeforeTurn(): { messages: Message[]; context: BeforeTurnContext } {
  const messages: Message[] = [];
  const context = {
    turn: 1,
    context: {},
    messages,
    addContext: (content: string) => messages.push({ role: 'user', content }),
    addInstructions: () => undefined,
  } as unknown as BeforeTurnContext;

  return { messages, context };
}
