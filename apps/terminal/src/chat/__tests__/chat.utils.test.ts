import { describe, expect, it } from 'vitest';
import type { Skill } from '@sheavly/workspace/skills/skills.types';
import { completeChatLine, listModels, parseChatInput, unknownCommand } from '../chat.utils.js';

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

  it('reads /model with or without a name, and not with more than one', () => {
    expect(parseChatInput('/model')).toEqual({ kind: 'model', name: undefined });
    expect(parseChatInput('/model  claude ')).toEqual({ kind: 'model', name: 'claude' });
    expect(parseChatInput('/model a b')).toEqual({ kind: 'prompt', text: '/model a b' });
  });
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

describe('listModels', () => {
  it('lists each model with its backend, marking the active one', () => {
    const choices = [
      { name: 'gpt', adapter: 'azure-openai', model: 'gpt-6.1-sol' },
      { name: 'claude', adapter: 'azure-anthropic', model: 'claude-sonnet' },
    ];

    expect(listModels({ choices, active: 'claude' })).toBe(
      '○ gpt: azure-openai / gpt-6.1-sol\n● claude: azure-anthropic / claude-sonnet',
    );
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
      ['/exit', '/help', '/model', '/quit', '/git', '/help-docs', '/review'],
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
