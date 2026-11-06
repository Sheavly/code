import { describe, expect, it } from 'vitest';
import { approvalLiteral } from '../approval-literal.utils.js';

describe('approvalLiteral', () => {
  it('keeps normal command text and quotes readable', () => {
    expect(approvalLiteral("git grep 'hello world' src")).toBe("git grep 'hello world' src");
  });

  it('shows CSI, OSC, C1 controls, line breaks and direction overrides as literal escapes', () => {
    expect(approvalLiteral('\u001b[2J\u001b]52;c;data\u0007\r\n\t\b\u009b2J\u202e')).toBe(
      '\\u001b[2J\\u001b]52;c;data\\u0007\\r\\n\\t\\b\\u009b2J\\u202e',
    );
  });

  it('distinguishes a real newline from the literal backslash-n characters', () => {
    expect(approvalLiteral('\n')).toBe('\\n');
    expect(approvalLiteral('\\n')).toBe('\\\\n');
  });
});
