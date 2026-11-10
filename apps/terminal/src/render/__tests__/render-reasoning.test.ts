import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../render.service.js';

const main = sessionIdSchema.parse('main');

describe('Renderer: reasoning activity', () => {
  const activity = (active: boolean): EntryEvent => ({
    seq: 0,
    type: 'reasoning_activity',
    active,
  });
  const session = { id: main, rootId: main, depth: 1 as const };
  const setup = () => {
    let out = '';
    const renderer = new Renderer(
      (text) => (out += text),
      () => 0,
    );

    return { renderer, output: () => out };
  };

  it('follows the signal without printing anything', () => {
    const { renderer, output } = setup();

    renderer.event(activity(true));
    expect(renderer.thinking).toBe(true);
    renderer.event(activity(false));
    expect(renderer.thinking).toBe(false);
    expect(output()).toBe('');
  });

  it.each<[string, EntryEvent]>([
    ['completion', { seq: 1, type: 'done', reason: 'completed', session }],
    ['cancellation', { seq: 1, type: 'done', reason: 'interrupted', session }],
    ['failure', { seq: 1, type: 'run_failed', error: 'boom', session }],
  ])('clears on %s', (_name, event) => {
    const { renderer } = setup();

    renderer.event(activity(true));
    renderer.event(event);
    expect(renderer.thinking).toBe(false);
  });

  it('clears when the stream ends without a terminal event', () => {
    const { renderer } = setup();

    renderer.event(activity(true));
    renderer.clearRunning();
    expect(renderer.thinking).toBe(false);
  });

  it("ignores a sub-agent's activity", () => {
    const { renderer } = setup();
    const entry: StreamEntry = {
      seq: 0,
      at: 0,
      kind: 'event',
      sessionId: sessionIdSchema.parse('child'),
      event: activity(true),
    };

    renderer.entry(entry, main);
    expect(renderer.thinking).toBe(false);
  });
});
