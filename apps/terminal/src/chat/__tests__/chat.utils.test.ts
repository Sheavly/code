import { describe, expect, it } from 'vitest';
import { listModels, parseChatInput } from '../chat.utils.js';

describe('parseChatInput', () => {
  it('sends a line as a prompt, trimmed, and ignores a blank one', () => {
    expect(parseChatInput('  fix the tests  ')).toEqual({ kind: 'prompt', text: 'fix the tests' });
    expect(parseChatInput('   ')).toEqual({ kind: 'empty' });
  });

  it('reads /exit, /quit and /help, and names an unknown command', () => {
    expect(parseChatInput('/exit')).toEqual({ kind: 'exit' });
    expect(parseChatInput(' /quit ')).toEqual({ kind: 'exit' });
    expect(parseChatInput('/help')).toEqual({ kind: 'help' });
    expect(parseChatInput('/nope')).toEqual({ kind: 'unknown', command: '/nope' });
  });

  it('reads /model with or without a name, and not with more than one', () => {
    expect(parseChatInput('/model')).toEqual({ kind: 'model', name: undefined });
    expect(parseChatInput('/model  claude ')).toEqual({ kind: 'model', name: 'claude' });
    expect(parseChatInput('/model a b')).toEqual({ kind: 'unknown', command: '/model a b' });
  });
});

describe('listModels', () => {
  it('lists each model with its backend, marking the active one', () => {
    const choices = [
      { name: 'gpt', adapter: 'azure', model: 'gpt-6.1-sol' },
      { name: 'claude', adapter: 'azure-anthropic', model: 'claude-sonnet' },
    ];

    expect(listModels({ choices, active: 'claude' })).toBe(
      '○ gpt: azure / gpt-6.1-sol\n● claude: azure-anthropic / claude-sonnet',
    );
  });
});
