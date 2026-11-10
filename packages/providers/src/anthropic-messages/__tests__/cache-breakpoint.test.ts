import { describe, expect, it } from 'vitest';
import { withCacheBreakpoint } from '../cache-breakpoint.utils.js';
import type { MessagesApiMessage } from '../messages.types.js';

const marker = { cache_control: { type: 'ephemeral' } };

describe('withCacheBreakpoint', () => {
  it('marks the last block of the last message, leaving the input as it was', () => {
    const input: MessagesApiMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }, { type: 'tool_result' }] },
    ];
    const original = structuredClone(input);
    const marked = withCacheBreakpoint(input);

    expect(marked[0]).toEqual(input[0]);
    expect(marked[1]?.content).toEqual([
      { type: 'text', text: 'b' },
      { type: 'tool_result', ...marker },
    ]);
    expect(input).toEqual(original);
  });

  it('skips trailing thinking blocks and marks the last block that can carry it', () => {
    const [message] = withCacheBreakpoint([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'a' },
          { type: 'thinking', thinking: 't', signature: 's' },
          { type: 'redacted_thinking', data: 'd' },
        ],
      },
    ]);

    expect(message?.content[0]).toEqual({ type: 'text', text: 'a', ...marker });
    expect(message?.content.slice(1)).not.toContainEqual(expect.objectContaining(marker));
  });

  it('leaves a final message of only thinking, and no messages, unmarked', () => {
    const thinking: MessagesApiMessage[] = [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 's' }] },
    ];

    expect(withCacheBreakpoint(thinking)).toEqual(thinking);
    expect(withCacheBreakpoint([])).toEqual([]);
  });
});
