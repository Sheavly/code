import { describe, expect, it } from 'vitest';
import type { Message } from '@sheavly/protocol/message/message.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { INTERRUPTED_CALL } from '../conversations.constants.js';
import { repairHistory } from '../conversations.utils.js';

const AT = 5_000;
const c1 = callIdSchema.parse('c1');
const c2 = callIdSchema.parse('c2');
const c3 = callIdSchema.parse('c3');

const user = (content: string): Message => ({ role: 'user', content, at: 1 });
const asking = (...ids: (typeof c1)[]): Message => ({
  role: 'assistant',
  content: '',
  toolCalls: ids.map((id) => ({ id, name: 'read_file', input: {} })),
  at: 2,
});
const result = (id: typeof c1, content = 'ok'): Message => ({
  role: 'tool',
  toolCallId: id,
  content,
  isError: false,
  at: 3,
});
const placeholder = (id: typeof c1): Message => ({
  role: 'tool',
  toolCallId: id,
  content: INTERRUPTED_CALL,
  isError: true,
  at: AT,
});

/** The roles and ids of a history, to read an order at a glance. */
const shape = (messages: readonly Message[]) =>
  messages.map((m) => (m.role === 'tool' ? `tool:${m.toolCallId}` : m.role));

describe('repairHistory', () => {
  it('returns a history that is already valid as it is', () => {
    const history = [user('go'), asking(c1, c2), result(c1), result(c2), user('next')];

    expect(repairHistory({ messages: history, at: AT })).toEqual(history);
    expect(repairHistory({ messages: [], at: AT })).toEqual([]);
  });

  it('gives a call with no result a placeholder, saying it returned nothing', () => {
    const repaired = repairHistory({ messages: [user('go'), asking(c1)], at: AT });

    expect(repaired).toEqual([user('go'), asking(c1), placeholder(c1)]);
    expect(repaired.at(-1)).toMatchObject({ isError: true, content: INTERRUPTED_CALL });
  });

  it('adds only the missing ones, after the results that did arrive, in call order', () => {
    const history = [user('go'), asking(c1, c2, c3), result(c2)];

    expect(shape(repairHistory({ messages: history, at: AT }))).toEqual([
      'user',
      'assistant',
      'tool:c2', // the result that came back stays where it was
      'tool:c1',
      'tool:c3',
    ]);
  });

  it('keeps the messages after a call’s results in place', () => {
    const history = [user('a'), asking(c1, c2), result(c1), user('b')];

    expect(shape(repairHistory({ messages: history, at: AT }))).toEqual([
      'user',
      'assistant',
      'tool:c1',
      'tool:c2',
      'user',
    ]);
  });

  it('repairs each assistant message on its own', () => {
    const history = [user('a'), asking(c1), user('b'), asking(c2), result(c2), user('c')];

    expect(shape(repairHistory({ messages: history, at: AT }))).toEqual([
      'user',
      'assistant',
      'tool:c1',
      'user',
      'assistant',
      'tool:c2',
      'user',
    ]);
  });

  it('leaves its input alone', () => {
    const history = [user('go'), asking(c1)];

    repairHistory({ messages: history, at: AT });
    expect(history).toHaveLength(2);
  });
});
