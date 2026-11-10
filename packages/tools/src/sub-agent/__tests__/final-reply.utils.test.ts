import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { NO_REPLY } from '../sub-agent.constants.js';
import { finalReply } from '../sub-agent.utils.js';

const callId = callIdSchema.parse('c1');
const user = (content: string): HistoryMessage => ({ role: 'user', content, at: 1 });
const said = (content: string): HistoryMessage => ({
  role: 'assistant',
  content,
  toolCalls: [],
  at: 2,
});
const called = (content: string): HistoryMessage => ({
  role: 'assistant',
  content,
  toolCalls: [{ id: callId, name: 'probe', input: {} }],
  at: 2,
});
const result: HistoryMessage = {
  role: 'tool',
  toolCallId: callId,
  content: 'found it',
  isError: false,
  at: 3,
};

describe('finalReply: what a sub-agent actually reported', () => {
  it('is the final answer whole, however long, with nothing cut', () => {
    const long = `REPORT-BEGIN\n${'Finding: e\n'.repeat(900)}REPORT-END`;

    expect(finalReply([user('task'), said(long)])).toBe(long);
  });

  it('joins every part of a reply that was cut at the output limit and continued, in order', () => {
    expect(
      finalReply([user('task'), said('FIRST-HALF: important findings'), said('LAST-HALF: checks')]),
    ).toBe('FIRST-HALF: important findingsLAST-HALF: checks');
  });

  it('leaves out what it said before its last tool call: that is work in progress', () => {
    const messages = [
      user('task'),
      called('Let me look at the file.'),
      result,
      said('The answer is 42.'),
    ];

    expect(finalReply(messages)).toBe('The answer is 42.');
  });

  it('leaves out commentary before an earlier tool result even when a continuation follows', () => {
    const messages = [
      user('task'),
      called('Checking.'),
      result,
      said('PART ONE. '),
      said('PART TWO.'),
    ];

    expect(finalReply(messages)).toBe('PART ONE. PART TWO.');
  });

  it('does not join an assistant message that made tool calls, even with no result between', () => {
    const messages = [
      user('task'),
      called('Working on it. '),
      said('PART ONE. '),
      said('PART TWO.'),
    ];

    expect(finalReply(messages)).toBe('PART ONE. PART TWO.');
  });

  it('skips a trailing empty message, such as an interrupted turn that said nothing', () => {
    expect(finalReply([user('task'), said('The report.'), said('   ')])).toBe('The report.');
  });

  it('does not reach past a message that is not an assistant reply', () => {
    expect(
      finalReply([said('earlier answer'), user('and another thing'), said('later answer')]),
    ).toBe('later answer');
  });

  it('gives the placeholder when the run ended on a tool call, not on a reply', () => {
    expect(finalReply([user('task'), called('Let me look.'), result])).toBe(NO_REPLY);
  });

  it('gives the placeholder when it never wrote any text', () => {
    expect(finalReply([user('task')])).toBe(NO_REPLY);
    expect(finalReply([user('task'), called('')])).toBe(NO_REPLY);
    expect(finalReply([])).toBe(NO_REPLY);
  });

  it('ignores progress and steering lines, which are never in its history as replies', () => {
    expect(finalReply([user('[message] Focus on puppies.'), said('Puppies.')])).toBe('Puppies.');
  });
});
