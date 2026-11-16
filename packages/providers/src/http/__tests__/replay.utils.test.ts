import { describe, expect, it } from 'vitest';
import type { ReasoningItem } from '@sheavly/protocol/message/message.types';
import { ownReplay, replaySource } from '../replay.utils.js';
import type { ReplayDrop } from '@sheavly/core/adapter/replay.types';

const own = replaySource({ protocol: 'chat', endpoint: 'https://a.test/v1', model: 'm' });
const items: ReasoningItem[] = [
  { source: own, data: 'mine' },
  { source: 'responses:https://a.test/v1#m', data: 'theirs' },
];

describe('replaySource credentials', () => {
  const source = (endpoint: string) => replaySource({ protocol: 'chat', endpoint, model: 'm' });

  it('drops userinfo from the endpoint', () => {
    expect(source('https://user:hunter2@a.test/v1')).toBe('chat:https://a.test/v1#m');
  });

  it('redacts secret-looking query values and keeps the api-version that tells endpoints apart', () => {
    const stored = source('https://a.test/v1?api-key=sk-secret123&api-version=2024-05-01');

    expect(stored).not.toContain('sk-secret123');
    expect(stored).toContain('api-version=2024-05-01');
  });

  it('still redacts when the endpoint is not a parseable URL', () => {
    expect(source('not a url token=abcdef')).not.toContain('abcdef');
  });
});

describe('replaySource', () => {
  it('names the protocol, endpoint and model', () => {
    expect(own).toBe('chat:https://a.test/v1#m');
  });
});

describe('ownReplay', () => {
  it('keeps what the source produced and reports each other item as a mismatch', () => {
    const drops: ReplayDrop[] = [];

    const kept = ownReplay({ items, source: own, onDropped: (drop) => drops.push(drop) });

    expect(kept).toEqual([items[0]]);
    expect(drops).toEqual([{ reason: 'source_mismatch', source: 'responses:https://a.test/v1#m' }]);
  });

  it('reports every item as replay_off when the provider keeps no reasoning', () => {
    const drops: ReplayDrop[] = [];

    const kept = ownReplay({ items, source: undefined, onDropped: (drop) => drops.push(drop) });

    expect(kept).toEqual([]);
    expect(drops.map((drop) => drop.reason)).toEqual(['replay_off', 'replay_off']);
  });

  it('accepts a missing item list and a missing handler', () => {
    expect(ownReplay({ items: undefined, source: own, onDropped: undefined })).toEqual([]);
    expect(ownReplay({ items, source: own, onDropped: undefined })).toEqual([items[0]]);
  });
});
