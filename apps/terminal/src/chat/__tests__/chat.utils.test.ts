import { describe, expect, it } from 'vitest';
import { parseChatInput } from '../chat.utils.js';

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
});
