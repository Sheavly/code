import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import type { Skill } from '@sheavly/coding/skills/skills.types';
import {
  completeChatLine,
  listModels,
  parseChatInput,
  pickModel,
  unknownCommand,
} from '../chat.utils.js';

describe('parseChatInput', () => {
  it('sends a line as a prompt, trimmed, and ignores a blank one', () => {
    expect(parseChatInput('  fix the tests  ')).toEqual({ kind: 'prompt', text: 'fix the tests' });
    expect(parseChatInput('   ')).toEqual({ kind: 'empty' });
  });

  it('reads /exit, /quit and /help, and sends any other line, skills and all', () => {
    expect(parseChatInput('/exit')).toEqual({ kind: 'exit' });
    expect(parseChatInput(' /quit ')).toEqual({ kind: 'exit' });
    expect(parseChatInput('/help')).toEqual({ kind: 'help' });
    expect(parseChatInput(' /git submit ')).toEqual({ kind: 'prompt', text: '/git submit' });
    expect(parseChatInput('then /git submit')).toEqual({
      kind: 'prompt',
      text: 'then /git submit',
    });
  });

  it('reads /changes with or without what to show, a path with spaces included', () => {
    expect(parseChatInput('/changes')).toEqual({ kind: 'changes', target: undefined });
    expect(parseChatInput('/changes #3')).toEqual({ kind: 'changes', target: '#3' });
    expect(parseChatInput(' /changes  my docs/a.md ')).toEqual({
      kind: 'changes',
      target: 'my docs/a.md',
    });
  });

  it('reads /errors with or without which failure to show', () => {
    expect(parseChatInput('/errors')).toEqual({ kind: 'errors', target: undefined });
    expect(parseChatInput(' /errors  #2 ')).toEqual({ kind: 'errors', target: '#2' });
  });

  it('reads /model with or without a name, and not with more than one', () => {
    expect(parseChatInput('/model')).toEqual({ kind: 'model', name: undefined });
    expect(parseChatInput('/model  claude ')).toEqual({ kind: 'model', name: 'claude' });
  });

  it.each(['/model a b', '/effort a b', '/help x'])(
    'rejects %s instead of sending it to the model',
    (line) => {
      expect(parseChatInput(line)).toMatchObject({ kind: 'usage' });
    },
  );
});

describe('unknownCommand', () => {
  it('names an unknown skill the message starts with, and not one later in it', () => {
    expect(unknownCommand({ text: '/nope do it', unknown: ['nope'] })).toBe('nope');
    expect(unknownCommand({ text: '/nope', unknown: ['nope'] })).toBe('nope');
    expect(unknownCommand({ text: 'do it /nope', unknown: ['nope'] })).toBeUndefined();
    expect(unknownCommand({ text: '/nopes', unknown: ['nope'] })).toBeUndefined();
    expect(unknownCommand({ text: 'look in /usr/bin', unknown: [] })).toBeUndefined();
  });
});

const GPT = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
const CLAUDE = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
const OTHER_GPT = modelIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
const choices = [
  { id: GPT, name: 'gpt', adapter: 'azure-openai', model: 'gpt-6.1-sol' },
  { id: CLAUDE, name: 'claude', adapter: 'azure-anthropic', model: 'claude-sonnet' },
];

describe('listModels', () => {
  it('lists each model with its backend and id, marking the active one by its id', () => {
    expect(listModels({ choices, active: CLAUDE })).toBe(
      `○ gpt: azure-openai / gpt-6.1-sol (${GPT})\n● claude: azure-anthropic / claude-sonnet (${CLAUDE})`,
    );
  });

  it('marks nothing for a name that is only a label, and both of two models called alike', () => {
    const twins = [...choices, { ...choices[0]!, id: OTHER_GPT }];

    expect(listModels({ choices: twins, active: OTHER_GPT }).split('\n')).toEqual([
      expect.stringContaining('○ gpt'),
      expect.stringContaining('○ claude'),
      expect.stringContaining('● gpt'),
    ]);
  });
});

describe('pickModel', () => {
  it('finds a model by its id', () => {
    expect(pickModel({ choices, typed: CLAUDE })).toEqual({ kind: 'found', choice: choices[1] });
  });

  it('finds a model by a label only one model has, and the switch is then made by its id', () => {
    const picked = pickModel({ choices, typed: 'gpt' });

    expect(picked).toEqual({ kind: 'found', choice: choices[0] });
    expect(picked.kind === 'found' && picked.choice.id).toBe(GPT);
  });

  it('refuses to guess between models that share a label, and takes the id of one', () => {
    const twins = [...choices, { ...choices[0]!, id: OTHER_GPT }];

    expect(pickModel({ choices: twins, typed: 'gpt' })).toEqual({
      kind: 'ambiguous',
      choices: [twins[0], twins[2]],
    });
    expect(pickModel({ choices: twins, typed: OTHER_GPT })).toEqual({
      kind: 'found',
      choice: twins[2],
    });
  });

  it('finds nothing for what is neither an id nor a label', () => {
    expect(pickModel({ choices, typed: 'huge' })).toEqual({ kind: 'none' });
    expect(pickModel({ choices, typed: GPT.toUpperCase() })).toEqual({ kind: 'none' });
  });
});

describe('completeChatLine', () => {
  const skills = ['git', 'review', 'help-docs'].map((name): Skill => ({
    name,
    description: '',
    manualOnly: false,
    dir: '',
    scope: 'project',
  }));

  it('completes / at the start to the chat commands and every skill', () => {
    expect(completeChatLine({ before: '/', skills })).toEqual([
      [
        '/changes',
        '/effort',
        '/errors',
        '/exit',
        '/help',
        '/model',
        '/quit',
        '/git',
        '/help-docs',
        '/review',
      ],
      '/',
    ]);
    expect(completeChatLine({ before: '/he', skills })).toEqual([['/help', '/help-docs'], '/he']);
  });

  it('completes a /<partial> later in the line to skills only', () => {
    expect(completeChatLine({ before: 'review this /re', skills })).toEqual([['/review'], '/re']);
    expect(completeChatLine({ before: 'then /', skills })[0]).toEqual([
      '/git',
      '/help-docs',
      '/review',
    ]);
  });

  it('offers nothing outside a /<partial>', () => {
    expect(completeChatLine({ before: 'look in /usr/b', skills })).toEqual([[], 'look in /usr/b']);
    expect(completeChatLine({ before: 'hello', skills })).toEqual([[], 'hello']);
  });
});
