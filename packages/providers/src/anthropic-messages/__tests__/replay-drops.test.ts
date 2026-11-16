import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ReplayDrop } from '../../http/replay.types.js';
import { toMessagesApiMessages } from '../input.utils.js';
import { messagesPrefix } from '../prefix.utils.js';

const source = 'messages:https://example.test/v1#claude';
const user: Message = { role: 'user', content: 'Go' };
const prefix = messagesPrefix({
  instructions: 'Fixed',
  tools: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Go' }] }],
});
const content = [
  { type: 'thinking', thinking: 'Hm', signature: 'sig' },
  { type: 'text', text: 'Done' },
];
const assistant: Message = {
  role: 'assistant',
  content: 'Done',
  toolCalls: [],
  reasoning: [{ source, data: { type: 'messages-replay', prefix, content } }],
};

/** The drops reported while translating `messages` under `instructions`. */
function dropsFor(params: { messages: Message[]; instructions?: string }): ReplayDrop[] {
  const drops: ReplayDrop[] = [];

  toMessagesApiMessages({
    messages: params.messages,
    reasoningSource: source,
    instructions: params.instructions ?? 'Fixed',
    tools: [],
    onReplayDropped: (drop) => drops.push(drop),
  });

  return drops;
}

describe('Messages replay drops', () => {
  it('reports nothing when the replay is sent whole', () => {
    expect(dropsFor({ messages: [user, assistant] })).toEqual([]);
  });

  it('reports prefix_changed when only the signed thinking is left out', () => {
    expect(dropsFor({ messages: [user, assistant], instructions: 'Changed' })).toEqual([
      { reason: 'prefix_changed', source },
    ]);
  });

  it('reports message_edited when the text no longer matches its replay state', () => {
    expect(dropsFor({ messages: [user, { ...assistant, content: 'Edited' }] })).toEqual([
      { reason: 'message_edited', source },
    ]);
  });

  it('reports invalid_state for a payload this protocol did not store', () => {
    const legacy: Message = {
      ...assistant,
      reasoning: [{ source, data: { type: 'thinking', signature: 'legacy' } }],
    };

    expect(dropsFor({ messages: [user, legacy] })).toEqual([{ reason: 'invalid_state', source }]);
  });

  it('reports source_mismatch for reasoning another endpoint produced', () => {
    const other = 'messages:https://other.test/v1#claude';
    const foreign: Message = {
      ...assistant,
      reasoning: [{ source: other, data: { type: 'messages-replay', prefix, content } }],
    };

    expect(dropsFor({ messages: [user, foreign] })).toEqual([
      { reason: 'source_mismatch', source: other },
    ]);
  });
});
