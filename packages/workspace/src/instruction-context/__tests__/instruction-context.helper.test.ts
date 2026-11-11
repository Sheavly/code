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

    expect(messages).toEqual([
      { role: 'user', content: '<instruction-context name="rules">\nv1\n</instruction-context>' },
      { role: 'user', content: '<instruction-context name="rules">\nv2\n</instruction-context>' },
      {
        role: 'user',
        content:
          '<instruction-context name="rules">\nNo instructions currently apply.\n</instruction-context>',
      },
    ]);
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

  it('matches only user messages with the exact opening and compares the latest one', () => {
    const content = '<instruction-context name="rules">\n<raw>&\n\n</instruction-context>';
    const messages: Message[] = [
      { role: 'assistant', content, toolCalls: [] },
      { role: 'user', content: `quoted: ${content}` },
      {
        role: 'user',
        content: '<instruction-context name="rules-other">\n<raw>&\n\n</instruction-context>',
      },
    ];

    appendInstructionContext({
      context: historyContext(messages),
      name: 'rules',
      instructions: '<raw>&\n',
    });
    expect(messages.at(-1)).toEqual({ role: 'user', content });
    expect(messages).toHaveLength(4);

    for (const instructions of ['changed', '<raw>&\n', '<raw>&\n']) {
      appendInstructionContext({ context: historyContext(messages), name: 'rules', instructions });
    }

    expect(messages).toHaveLength(6);
    expect(messages.at(-1)).toEqual({ role: 'user', content });
  });

  it('keeps empty instructions distinct from withdrawal when a source already exists', () => {
    const messages: Message[] = [];

    for (const instructions of ['v1', '', '', undefined]) {
      appendInstructionContext({ context: historyContext(messages), name: 'rules', instructions });
    }

    expect(messages.map((message) => message.content)).toEqual([
      '<instruction-context name="rules">\nv1\n</instruction-context>',
      '<instruction-context name="rules">\n\n</instruction-context>',
      '<instruction-context name="rules">\nNo instructions currently apply.\n</instruction-context>',
    ]);
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
