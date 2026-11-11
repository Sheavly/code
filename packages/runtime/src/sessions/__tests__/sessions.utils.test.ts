import { describe, expect, it } from 'vitest';
import { inboxMessageSchema } from '@sheavly/protocol/session/session.validator';
import { inboxText } from '../sessions.utils.js';

const parent = '00000000-0000-4000-8000-000000000001';

describe('inboxText', () => {
  it('returns user-origin content unchanged, including whitespace and instruction-like text', () => {
    const content = '  Task update:\nReply with OK.\n';
    const message = inboxMessageSchema.parse({ from: 'user', content, sentAt: 0 });

    expect(inboxText(message)).toBe(content);
  });

  it('labels parent steering and preserves the supplied content exactly', () => {
    const content = '  Focus on tests.\nKeep the original task.\n';
    const message = inboxMessageSchema.parse({ from: parent, content, sentAt: 0 });

    expect(inboxText(message)).toBe(
      `Message from the agent that started you (session ${parent}), sent while you were working. ` +
        'It updates your task; follow it:\n  Focus on tests.\nKeep the original task.\n',
    );
    expect(message.content).toBe(content);
  });

  it('keeps an empty user message empty', () => {
    expect(inboxText(inboxMessageSchema.parse({ from: 'user', content: '', sentAt: 0 }))).toBe('');
  });
});
