import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import { InstructionSourceError } from '../../errors/instruction-source.errors.js';
import type { BeforeTurnContext } from '../../hook/hook.types.js';
import { createInstructionHook, registerInstructionHooks } from '../instruction-source.helper.js';
import type { InstructionSource } from '../instruction-source.types.js';

function source(name: string, order: number, text = name): InstructionSource {
  return { name, order, resolve: () => text };
}

/** Runs one turn of a hook over `messages`, as the loop does with the history it holds. */
async function turnOver(params: { source: InstructionSource; messages: Message[] }) {
  const { messages } = params;
  const context = {
    turn: 1,
    context: {},
    signal: new AbortController().signal,
    messages,
    addContext: (content: string) => messages.push({ role: 'user', content }),
    addInstructions: () => undefined,
  } as unknown as BeforeTurnContext;

  await createInstructionHook(params.source).hook.beforeTurn?.(context);
}

describe('createInstructionHook working root', () => {
  it('hands the source the folder its working roots name this turn', async () => {
    const messages: Message[] = [];
    let folder: string | undefined = '/one';
    const rules: InstructionSource = {
      name: 'rules',
      order: 1,
      workingRoots: { root: () => Promise.resolve(folder) },
      resolve: ({ workingRoot }) => `at ${workingRoot ?? 'nowhere'}`,
    };

    await turnOver({ source: rules, messages });
    folder = undefined;
    await turnOver({ source: rules, messages });

    expect(messages.map((m) => m.content)).toEqual([
      '<instruction-context name="rules">\nat /one\n</instruction-context>',
      '<instruction-context name="rules">\nat nowhere\n</instruction-context>',
    ]);
  });

  it('fails the turn when the working roots throw: its owner decides what unusable means', async () => {
    const rules: InstructionSource = {
      name: 'rules',
      order: 1,
      workingRoots: { root: () => Promise.reject(new Error('gone')) },
      resolve: () => 'never',
    };

    await expect(turnOver({ source: rules, messages: [] })).rejects.toThrow('gone');
  });
});

describe('instruction dedup', () => {
  it('announces once while the entry stays in history, even when other history is masked', async () => {
    const messages: Message[] = [];
    const rules = source('rules', 1, 'v1');

    await turnOver({ source: rules, messages });
    messages.push({ role: 'user', content: 'a masked tool output' });
    await turnOver({ source: rules, messages });

    expect(messages.filter((m) => m.content.startsWith('<instruction-context'))).toHaveLength(1);
  });

  it('announces again once a summary or masking dropped the entry from history', async () => {
    const messages: Message[] = [];
    const rules = source('rules', 1, 'v1');

    await turnOver({ source: rules, messages });
    messages.splice(0, messages.length, { role: 'user', content: 'summary of the run' });
    await turnOver({ source: rules, messages });

    expect(messages.map((m) => m.content)).toEqual([
      'summary of the run',
      '<instruction-context name="rules">\nv1\n</instruction-context>',
    ]);
  });
});

describe('registerInstructionHooks', () => {
  it('orders hooks by their declared order, not by registration position', () => {
    const hooks = registerInstructionHooks([
      createInstructionHook(source('third', 30)),
      createInstructionHook(source('first', 10)),
      createInstructionHook(source('second', 20)),
    ]);

    expect(hooks.map((hook) => hook.name)).toEqual(['first', 'second', 'third']);
  });

  it('keeps registration order for equal orders', () => {
    const hooks = registerInstructionHooks([
      createInstructionHook(source('a', 1)),
      createInstructionHook(source('b', 1)),
    ]);

    expect(hooks.map((hook) => hook.name)).toEqual(['a', 'b']);
  });

  it('fails on two sources with one name', () => {
    expect(() =>
      registerInstructionHooks([
        createInstructionHook(source('same', 1)),
        createInstructionHook(source('same', 2)),
      ]),
    ).toThrow(InstructionSourceError);
  });
});
