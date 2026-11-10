import { describe, expect, it } from 'vitest';
import { collect } from '@sheavly/testing/fetch/fake-fetch.fake';
import { chatChunkSchema } from '../chat-completions.validator.js';
import { chatCall, chatFrame, chatTransport } from '../../testing/chat-completions.fake.js';

const base = { prompt_tokens: 20, completion_tokens: 4 };
const accepted = [
  {},
  { prompt_tokens_details: null },
  { prompt_tokens_details: {} },
  { prompt_cache_miss_tokens: 20 },
  { prompt_cache_miss_tokens: null },
  { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: null },
  { prompt_cache_hit_tokens: 8 },
  { prompt_tokens_details: { cached_tokens: 8 } },
  { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 12 },
  { prompt_tokens_details: { cached_tokens: 8 }, prompt_cache_miss_tokens: 12 },
  { prompt_tokens_details: null, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 12 },
  {
    prompt_tokens_details: { cached_tokens: 8 },
    prompt_cache_hit_tokens: 8,
    prompt_cache_miss_tokens: 12,
  },
  { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 20 },
  { prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 0 },
  { prompt_cache_hit_tokens: null },
  { prompt_cache_hit_tokens: null, prompt_cache_miss_tokens: 20 },
  { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 11 },
  { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 13 },
  { prompt_tokens_details: { cached_tokens: 8 }, prompt_cache_miss_tokens: 13 },
  { prompt_tokens_details: { cached_tokens: null } },
  { prompt_tokens_details: { cached_tokens: 8 }, prompt_cache_hit_tokens: 9 },
  { prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 1 },
];
const rejected = [
  { prompt_cache_miss_tokens: -1 },
  { prompt_cache_miss_tokens: 0.5 },
  { prompt_cache_miss_tokens: '12' },
  { prompt_cache_miss_tokens: 21 },
  { prompt_cache_hit_tokens: -1 },
  { prompt_cache_hit_tokens: 1.5 },
  { prompt_cache_hit_tokens: 21 },
  { prompt_tokens_details: { cached_tokens: 21 } },
];

describe('Chat cache usage boundary', () => {
  it.each(accepted)('accepts compatible or unreported usage %j', (details) => {
    expect(chatChunkSchema.safeParse({ choices: [], usage: { ...base, ...details } }).success).toBe(
      true,
    );
  });

  it.each(rejected)('rejects malformed or impossible usage %j', (details) => {
    expect(chatChunkSchema.safeParse({ choices: [], usage: { ...base, ...details } }).success).toBe(
      false,
    );
  });

  it.each([undefined, null])('keeps absent usage %s absent', async (usage) => {
    const { provider } = chatTransport({
      responses: [[chatFrame({ finish: 'stop' }), { choices: [], usage }]],
    });

    expect(await collect(provider.stream(chatCall()))).toEqual([
      { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it.each(accepted)('counts reads once, never counts misses as writes %j', async (details) => {
    const { provider } = chatTransport({
      responses: [[chatFrame({ finish: 'stop' }), { choices: [], usage: { ...base, ...details } }]],
    });
    const parsed = chatChunkSchema.parse({ choices: [], usage: { ...base, ...details } });
    const reads =
      parsed.usage?.prompt_tokens_details?.cached_tokens ??
      parsed.usage?.prompt_cache_hit_tokens ??
      0;

    expect(await collect(provider.stream(chatCall()))).toEqual([
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: {
          tokens: { inputTokens: 20, outputTokens: 4, cacheReadTokens: reads, cacheWriteTokens: 0 },
        },
      },
    ]);
  });

  it.each(rejected)(
    'fails the stream closed on malformed or impossible usage %j',
    async (details) => {
      const { provider } = chatTransport({
        responses: [
          [chatFrame({ finish: 'stop' }), { choices: [], usage: { ...base, ...details } }],
        ],
      });

      await expect(collect(provider.stream(chatCall()))).rejects.toMatchObject({
        reason: 'bad_payload',
      });
    },
  );

  it.each([
    { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 11 },
    { prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 13 },
  ])('keeps the reply a provider also counts inconsistently %j', async (details) => {
    const { provider } = chatTransport({
      responses: [
        [
          chatFrame({ delta: { content: 'answer' }, finish: 'stop' }),
          { choices: [], usage: { ...base, ...details } },
        ],
      ],
    });

    const events = await collect(provider.stream(chatCall()));

    expect(events).toContainEqual({ type: 'text_delta', text: 'answer' });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { tokens: { cacheReadTokens: 8 } },
    });
  });

  it('accepts an empty measured prompt and zero cache counts', () => {
    expect(
      chatChunkSchema.safeParse({
        choices: [],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 0,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }).success,
    ).toBe(true);
  });
});
