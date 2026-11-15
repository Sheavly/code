import { describe, expect, it, vi } from 'vitest';
import { unknownPromptCommand } from '../chat-prompt.helper.js';

function conversationWith(names: string[]) {
  const skills = vi.fn(() =>
    Promise.resolve(
      names.map((name) => ({
        name,
        description: '',
        manualOnly: false,
        scope: 'project' as const,
      })),
    ),
  );

  return { skills };
}

describe('unknownPromptCommand', () => {
  it('does not ask the backend for skills when the text mentions none', async () => {
    const conversation = conversationWith([]);

    expect(await unknownPromptCommand({ text: 'fix the tests', conversation })).toBeUndefined();
    expect(conversation.skills).not.toHaveBeenCalled();
  });

  it('names a leading command no skill has', async () => {
    const conversation = conversationWith(['git']);

    expect(await unknownPromptCommand({ text: '/nope do it', conversation })).toBe('nope');
    expect(conversation.skills).toHaveBeenCalledTimes(1);
  });

  it('leaves a known skill alone', async () => {
    const conversation = conversationWith(['git']);

    expect(await unknownPromptCommand({ text: '/git submit', conversation })).toBeUndefined();
  });
});
