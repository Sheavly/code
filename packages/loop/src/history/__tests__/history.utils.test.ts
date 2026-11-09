import { describe, expect, it } from 'vitest';
import { InvalidHistoryError } from '../../errors/loop.errors.js';
import { assertValidHistory, countChanges } from '../history.utils.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { Message } from '@sheavly/protocol/message/message.types';

const id = (value: string) => callIdSchema.parse(value);
const user = (content: string): Message => ({ role: 'user', content, at: 1 });
const assistant = (...calls: string[]): Message => ({
  role: 'assistant',
  content: '',
  toolCalls: calls.map((call) => ({ id: id(call), name: 'ping', input: {} })),
  at: 2,
});
const result = (call: string): Message => ({
  role: 'tool',
  toolCallId: id(call),
  content: 'pong',
  isError: false,
  at: 3,
});

const check = (messages: Message[], latestUser?: Message) => () =>
  assertValidHistory({ messages, latestUser, source: 'Hook trim' });

describe('assertValidHistory: pairing', () => {
  it('accepts plain turns and parallel calls', () => {
    expect(check([user('a'), assistant(), user('b')])).not.toThrow();
    expect(check([user('a'), assistant('1', '2'), result('1'), result('2')])).not.toThrow();
  });

  it('rejects an empty list, which no provider accepts', () => {
    expect(check([])).toThrow('there are no messages to send');
  });

  it('rejects an assistant message that repeats a call id', () => {
    expect(check([user('a'), assistant('1', '1'), result('1')])).toThrow(
      'an assistant message repeats a tool call id',
    );
  });

  it('cuts a long call id short in the message', () => {
    const long = 'x'.repeat(200);

    expect(check([user('a'), assistant(long)])).toThrow(
      `tool call ${'x'.repeat(40)}… has no result`,
    );
  });

  it('rejects a tool call without a result, naming the source and the call', () => {
    expect(check([user('a'), assistant('1'), user('b')])).toThrow(InvalidHistoryError);
    expect(check([user('a'), assistant('1'), user('b')])).toThrow(
      'Hook trim produced invalid history: tool call 1 has no result before the next user message',
    );
  });

  it('rejects a tool call left open at the end of the history', () => {
    expect(check([user('a'), assistant('1', '2'), result('1')])).toThrow(
      'tool call 2 has no result',
    );
  });

  it('rejects a result without its call, or one that comes before it', () => {
    expect(check([user('a'), result('9')])).toThrow('tool result 9 has no tool call before it');
    expect(check([user('a'), result('1'), assistant('1')])).toThrow(InvalidHistoryError);
  });

  it('rejects a result that sits after another assistant message, away from its call', () => {
    expect(check([user('a'), assistant('1'), assistant(), result('1')])).toThrow(
      'tool call 1 has no result before the next assistant message',
    );
  });
});

describe('assertValidHistory: latest user message', () => {
  it('accepts a history that ends with the same message, however much came before', () => {
    const latest = user('now');

    expect(check([latest], latest)).not.toThrow();
    expect(check([user('old'), assistant(), { ...latest }], latest)).not.toThrow();
  });

  it('rejects a removed latest message, even when an older user message is left', () => {
    expect(check([user('old')], user('now'))).toThrow(
      'the latest user message was removed or changed',
    );
    expect(check([], user('now'))).toThrow(InvalidHistoryError);
  });

  it('rejects a reworded latest message', () => {
    expect(check([user('n0w')], user('now'))).toThrow(InvalidHistoryError);
  });

  it('does not look at user messages when none is expected', () => {
    expect(check([assistant()])).not.toThrow();
  });
});

describe('countChanges', () => {
  const none = { added: 0, removed: 0, edited: 0 };

  it('reports nothing for equal messages, even when they are new objects', () => {
    const before = [user('a'), assistant('1'), result('1')];

    expect(countChanges({ before, after: structuredClone(before) })).toEqual(none);
  });

  it('counts a rewritten tool result and an assistant message with calls as edits', () => {
    const before = [user('a'), assistant('1'), result('1')];
    const after = [
      user('a'),
      { ...assistant('1'), content: 'thinking' },
      { ...result('1'), content: '[hidden]' },
    ];

    expect(countChanges({ before, after })).toEqual({ ...none, edited: 2 });
  });

  it('counts a reworded user message as one removed and one added', () => {
    expect(countChanges({ before: [user('a')], after: [user('b')] })).toEqual({
      added: 1,
      removed: 1,
      edited: 0,
    });
  });

  it('matches duplicates one for one, so a dropped copy is one removal', () => {
    expect(countChanges({ before: [user('a'), user('a')], after: [user('a')] })).toEqual({
      ...none,
      removed: 1,
    });
  });

  it('never confuses an assistant message with calls [a,b] with plain text "a,b"', () => {
    const plain: Message = { role: 'assistant', content: 'a,b', toolCalls: [], at: 2 };

    expect(countChanges({ before: [assistant('a', 'b')], after: [plain] })).toEqual({
      added: 1,
      removed: 1,
      edited: 0,
    });
  });

  it('does not report a reorder', () => {
    expect(countChanges({ before: [user('a'), user('b')], after: [user('b'), user('a')] })).toEqual(
      none,
    );
  });
});
