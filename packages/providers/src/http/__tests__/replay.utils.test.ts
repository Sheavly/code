import { describe, expect, it } from 'vitest';
import type { ReasoningItem } from '@sheavly/protocol/message/message.types';
import { ownReplay, replaySource } from '../replay.utils.js';
import type { ReplayDrop } from '../replay.types.js';

const own = replaySource({ protocol: 'chat', endpoint: 'https://a.test/v1', model: 'm' });
const items: ReasoningItem[] = [
  { source: own, data: 'mine' },
  { source: 'responses:https://a.test/v1#m', data: 'theirs' },
];

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
