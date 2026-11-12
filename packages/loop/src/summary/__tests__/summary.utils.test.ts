import { describe, expect, it } from 'vitest';
import {
  callIdSchema,
  messageIdSchema,
  summarySectionIdSchema,
} from '@sheavly/protocol/message/message.validator';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import { DEFAULT_SUMMARY_POLICY } from '../summary.constants.js';
import {
  chooseCut,
  keepTokensFor,
  latestCheckpoint,
  shouldSummarize,
  spanToSummarize,
  viewOf,
} from '../summary.utils.js';

describe('keepTokensFor', () => {
  const WINDOW = 100_000;

  it('lands the context between 15% and 50% of the window, less room for the checkpoint', () => {
    const keep = (used: number) => keepTokensFor({ window: WINDOW, used, fallback: 15_000 });

    // 35% of 90k is 31.5k, less the 10k reserve.
    expect(keep(90_000)).toBe(21_500);
    // A nearly empty context still keeps the 15% floor, less the reserve.
    expect(keep(1_000)).toBe(5_000);
    // A context beyond the window cannot ask for more than the 50% ceiling, less the reserve.
    expect(keep(400_000)).toBe(40_000);
  });

  it('works without a reported usage, from the window alone, and never keeps nothing', () => {
    expect(keepTokensFor({ window: WINDOW, used: undefined, fallback: 15_000 })).toBe(25_000);
    expect(keepTokensFor({ window: 10, used: 1, fallback: 15_000 })).toBeGreaterThanOrEqual(1);
  });

  it('uses the fixed tail where the window is unknown', () => {
    expect(keepTokensFor({ window: undefined, used: 5_000, fallback: 15_000 })).toBe(15_000);
  });
});

/** 40 characters: ten tokens by the estimate. */
const TEXT = 'x'.repeat(40);
const user = (content = TEXT): HistoryMessage => ({ role: 'user', content, at: 1 });
const assistant = (...calls: string[]): HistoryMessage => ({
  role: 'assistant',
  content: TEXT,
  toolCalls: calls.map((id) => ({ id: callIdSchema.parse(id), name: 'p', input: {} })),
  at: 2,
});
const result = (call: string): HistoryMessage => ({
  role: 'tool',
  toolCallId: callIdSchema.parse(call),
  content: TEXT,
  isError: false,
  at: 3,
});
const checkpoint = (params: { kept: number; body?: string }): HistoryMessage => ({
  role: 'summary',
  sections: [{ id: summarySectionIdSchema.parse('goal'), title: 'Goal', body: params.body ?? 's' }],
  kept: params.kept,
  summarized: 1,
  summarizer: 'test',
  at: 4,
});

describe('shouldSummarize', () => {
  const policy = DEFAULT_SUMMARY_POLICY;
  const at = (used: number) => shouldSummarize({ context: { window: 300_000, used }, policy });

  it('triggers only once less than the buffer (15% of the window) is free', () => {
    expect(at(254_999)).toBe(false);
    expect(at(255_000)).toBe(false);
    expect(at(255_001)).toBe(true);
  });

  it('triggers at 85% of a small window too, with no extra floor by default', () => {
    const small = (used: number) => shouldSummarize({ context: { window: 20_000, used }, policy });

    expect(small(17_000)).toBe(false);
    expect(small(17_001)).toBe(true);
  });

  it('uses a minimum free room a UI asks for, but never more than half of the window', () => {
    const floored = { ...policy, minFreeTokens: 16_000 };
    const small = (used: number) =>
      shouldSummarize({ context: { window: 20_000, used }, policy: floored });

    expect(small(10_000)).toBe(false);
    expect(small(10_001)).toBe(true);
  });

  it('does nothing when the window or the last call’s usage is unknown', () => {
    expect(shouldSummarize({ context: { used: 900_000 }, policy })).toBe(false);
    expect(shouldSummarize({ context: { window: 300_000 }, policy })).toBe(false);
  });
});

describe('chooseCut', () => {
  it('keeps about keepTokens in the tail and cuts before it', () => {
    const history = [user(), assistant(), user(), assistant(), user()];

    expect(chooseCut({ history, keepTokens: 25 })).toBe(2);
  });

  it('never splits a tool call from its result: the tail starts at the call', () => {
    const history = [user(), assistant('c1'), result('c1'), user()];

    // The estimate would start the tail at the result (index 2); the call comes with it.
    expect(chooseCut({ history, keepTokens: 15 })).toBe(1);
  });

  it('keeps parallel calls and every result together, placeholders included', () => {
    const history = [user(), assistant('c1', 'c2'), result('c1'), result('c2'), user()];

    expect(chooseCut({ history, keepTokens: 25 })).toBe(1);
  });

  it('may cut past the latest user message, which the view pins, however large the reply after it', () => {
    const big: HistoryMessage = { role: 'assistant', content: 'y'.repeat(4_000), toolCalls: [] };
    const history = [user(), assistant(), user(), big];

    expect(chooseCut({ history, keepTokens: 10 })).toBe(3);
  });

  it('summarizes the work after a single prompt: the prompt is pinned, not summarized', () => {
    const history = [user('only prompt')];

    for (let n = 0; n < 6; n++) history.push(assistant(`c${String(n)}`), result(`c${String(n)}`));

    // The tail holds the last two rounds; everything between the prompt and it is summarized.
    expect(chooseCut({ history, keepTokens: 40 })).toBe(9);
    expect(spanToSummarize({ history, cut: 9 }).messages).toHaveLength(9);
  });

  it('is undefined when only the pinned prompt lies before the tail', () => {
    const history = [user(), assistant('c1'), result('c1')];

    expect(chooseCut({ history, keepTokens: 25 })).toBeUndefined();
  });

  it('is undefined when nothing older than the tail is left to summarize', () => {
    expect(chooseCut({ history: [user()], keepTokens: 5 })).toBeUndefined();
    expect(chooseCut({ history: [], keepTokens: 5 })).toBeUndefined();
    expect(chooseCut({ history: [assistant()], keepTokens: 5 })).toBeUndefined();
  });

  it('looks only at what the model still sees after an earlier checkpoint', () => {
    const history = [user(), assistant(), checkpoint({ kept: 2 }), user(), assistant(), user()];

    // The first two messages were already replaced; the cut is within [2..].
    expect(chooseCut({ history, keepTokens: 15 })).toBeGreaterThanOrEqual(2);
  });
});

describe('viewOf', () => {
  it('is the history when there is no checkpoint', () => {
    const history = [user('a'), assistant(), user('b')];

    expect(viewOf(history)).toEqual(history);
  });

  it('puts the checkpoint, as text, in front of the messages it kept and what followed', () => {
    const history = [user('m0'), user('m1'), user('m2'), checkpoint({ kept: 2 }), user('m4')];
    const view = viewOf(history);

    expect(view).toHaveLength(4);
    expect(view[0]).toMatchObject({ role: 'user' });
    expect(view[0]?.role === 'user' && view[0].content).toContain('<earlier-work-summary>');
    expect(view.slice(1)).toEqual([history[1], history[2], history[4]]);
  });

  it('pins the latest prompt word for word after the checkpoint when the tail starts later', () => {
    const prompt = user('the request');
    const history = [prompt, assistant('c1'), result('c1'), assistant('c2'), result('c2')];
    const withCheckpoint = [...history, checkpoint({ kept: 2 })];
    const view = viewOf(withCheckpoint);

    expect(view[0]?.role === 'user' && view[0].content).toContain('<earlier-work-summary>');
    expect(view.slice(1)).toEqual([prompt, history[3], history[4]]);
  });

  it('does not repeat a prompt the tail already holds, and pins a person’s prompt over a notice', () => {
    const typed: HistoryMessage = {
      role: 'user',
      content: 'the request',
      id: messageIdSchema.parse('00000000-0000-4000-8000-000000000001'),
      at: 1,
    };
    const notice = user('Background task finished');
    const history = [typed, assistant('c1'), result('c1'), notice, assistant('c2'), result('c2')];
    const view = viewOf([...history, checkpoint({ kept: 2 })]);

    // Both the person's prompt and the later notice stay: the model answers the last user
    // message, and the request it is working on is not lost behind a notice.
    expect(view.slice(1)).toEqual([typed, notice, history[4], history[5]]);
    expect(viewOf([typed, checkpoint({ kept: 1 })]).slice(1)).toEqual([typed]);
  });

  it('shows only the newest of two checkpoints, folded over the first', () => {
    const history = [
      user('m0'),
      user('m1'),
      checkpoint({ kept: 1, body: 'first' }),
      user('m3'),
      user('m4'),
      checkpoint({ kept: 2, body: 'second' }),
    ];
    const view = viewOf(history);
    const text = view[0]?.role === 'user' ? view[0].content : '';

    expect(text).toContain('second');
    expect(text).not.toContain('first');
    expect(view.slice(1)).toEqual([history[3], history[4]]);
  });

  it('leaves the stored history as it was and never shows a summary role', () => {
    const history = [user('m0'), user('m1'), checkpoint({ kept: 1 })];
    const before = structuredClone(history);

    const roles: string[] = viewOf(history).map((message) => message.role);

    expect(roles).not.toContain('summary');
    expect(history).toEqual(before);
  });
});

describe('a second checkpoint in a run of one prompt', () => {
  it('keeps pinning the prompt, and summarizes only what came after the first tail', () => {
    const prompt = user('the request');
    const history: HistoryMessage[] = [prompt];

    for (let n = 0; n < 4; n++) history.push(assistant(`a${String(n)}`), result(`a${String(n)}`));

    history.push(checkpoint({ kept: 2, body: 'first' }));

    for (let n = 0; n < 4; n++) history.push(assistant(`b${String(n)}`), result(`b${String(n)}`));

    const cut = chooseCut({ history, keepTokens: 40 });

    expect(cut).toBeDefined();

    const { previous, messages } = spanToSummarize({ history, cut: cut ?? 0 });

    // The prompt is older than the first checkpoint's tail, so it is not summarized again.
    expect(messages).not.toContain(prompt);
    expect(previous?.sections[0]?.body).toBe('first');

    const view = viewOf([
      ...history,
      checkpoint({ kept: history.length - (cut ?? 0), body: 'second' }),
    ]);

    expect(view.slice(1, 2)).toEqual([prompt]);
  });
});

describe('spanToSummarize', () => {
  it('is everything before the cut when there is no checkpoint yet', () => {
    const history = [user('a'), user('b'), user('c')];

    expect(spanToSummarize({ history, cut: 2 })).toEqual({
      previous: undefined,
      messages: [history[0], history[1]],
    });
  });

  it('merges into the newest checkpoint: its sections, and the messages since its tail began', () => {
    const history = [user('m0'), user('m1'), checkpoint({ kept: 1 }), user('m3'), user('m4')];
    const { previous, messages } = spanToSummarize({ history, cut: 4 });

    expect(previous?.sections[0]?.body).toBe('s');
    expect(messages).toEqual([history[1], history[3]]);
  });
});

describe('latestCheckpoint', () => {
  it('finds the newest one and where it is', () => {
    const history = [user(), checkpoint({ kept: 1 }), user(), checkpoint({ kept: 1 })];

    expect(latestCheckpoint(history)?.index).toBe(3);
    expect(latestCheckpoint([user()])).toBeUndefined();
  });
});
