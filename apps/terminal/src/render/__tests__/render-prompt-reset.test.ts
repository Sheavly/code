import { describe, expect, it, vi } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../render.service.js';
import { createChatLook } from '../chat-look.utils.js';

const main = sessionIdSchema.parse('main');
const session = { id: main, rootId: main, depth: 1 as const };

const text = (value: string): EntryEvent => ({ seq: 0, type: 'text_delta', text: value });
const reasoning = { seq: 0, type: 'reasoning', items: [] } as unknown as EntryEvent;
const failed: EntryEvent = { seq: 1, type: 'run_failed', error: 'boom', session };
const done = (seq: number): EntryEvent => ({ seq, type: 'done', reason: 'completed', session });

describe('Renderer: per-prompt state', () => {
  it('starts the next prompt fresh after a run that ends without done', () => {
    const out: string[] = [];
    const end = vi.fn();
    const renderer = new Renderer(
      (chunk) => out.push(chunk),
      () => 0,
      createChatLook(),
      { write: (chunk) => out.push(chunk), end },
    );

    renderer.event(text('partial'));
    renderer.event(failed);
    expect(end).toHaveBeenCalledTimes(1);

    const before = out.length;

    renderer.event(text('next'));

    // No gap before it, as after a `done`.
    expect(out.slice(before).join('')).toBe('next');
  });

  it('counts reasoning items per prompt, not across prompts', () => {
    const out: string[] = [];
    const renderer = new Renderer(
      (chunk) => out.push(chunk),
      () => 0,
    );

    renderer.event(reasoning);
    renderer.event(done(1));
    renderer.event(done(1));

    expect(out.at(-1)).toContain('reasoning items kept: 0');
  });

  it('does not carry reasoning from a failed run into the next prompt', () => {
    const out: string[] = [];
    const renderer = new Renderer(
      (chunk) => out.push(chunk),
      () => 0,
    );

    renderer.event(reasoning);
    renderer.event(failed);
    renderer.event(done(1));

    expect(out.at(-1)).toContain('reasoning items kept: 0');
  });
});
