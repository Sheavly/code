import { describe, expect, it } from 'vitest';
import { plainTerminalText } from '../terminal-text.utils.js';

describe('plainTerminalText', () => {
  it('preserves Markdown, source backslashes, newlines and tabs', () => {
    const text = '**bold**\n\tconst x = "\\n"; 界🙂';

    expect(plainTerminalText(text)).toBe(text);
  });

  it('makes controls visible, including independently streamed pieces of an OSC sequence', () => {
    expect(
      plainTerminalText('before\u001b]') + plainTerminalText('52;c;data\u0007after\u202e'),
    ).toBe('before\\u001b]52;c;data\\u0007after\\u202e');
  });
});
