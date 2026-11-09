import { describe, expect, it } from 'vitest';
import type { BeforeTurnContext } from '@sheavly/core/hook/hook.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { appendInstructionContext } from '../instruction-context.helper.js';

function historyContext(messages: Message[]): BeforeTurnContext {
  return {
    messages,
    signal: new AbortController().signal,
    turn: 1,
    context: {},
    addContext: (content) => {
      messages.push({ role: 'user', content });
    },
    addInstructions: () => {
      throw new Error('The system prefix must not change');
    },
  };
}

describe('appendInstructionContext', () => {
  it('deduplicates unchanged context from history, including after reopening', () => {
    const messages: Message[] = [];

    appendInstructionContext({
      context: historyContext(messages),
      name: 'rules',
      instructions: 'v1',
    });
    const reopened = JSON.parse(JSON.stringify(messages)) as Message[];

    appendInstructionContext({
      context: historyContext(reopened),
      name: 'rules',
      instructions: 'v1',
    });

    expect(reopened).toEqual(messages);
    expect(messages).toHaveLength(1);
  });

  it('appends edits and removal, leaving earlier context unchanged', () => {
    const messages: Message[] = [];

    for (const instructions of ['v1', 'v2', undefined, undefined]) {
      appendInstructionContext({ context: historyContext(messages), name: 'rules', instructions });
    }

    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toContain('v1');
    expect(messages[1]?.content).toContain('v2');
    expect(messages[2]?.content).toContain('No instructions currently apply');
  });

  it('does not share state between sessions or instruction sources', () => {
    const main: Message[] = [];
    const child: Message[] = [];

    for (const messages of [main, child]) {
      for (const name of ['agents-md', 'skills']) {
        appendInstructionContext({ context: historyContext(messages), name, instructions: 'same' });
      }
    }

    expect(main).toEqual(child);
    expect(main).toHaveLength(2);
  });

  it('adds nothing for a source that has never had instructions', () => {
    const messages: Message[] = [];

    appendInstructionContext({
      context: historyContext(messages),
      name: 'rules',
      instructions: undefined,
    });

    expect(messages).toEqual([]);
  });
});
