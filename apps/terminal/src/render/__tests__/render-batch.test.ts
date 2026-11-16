import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { batchOf, step } from '../../testing/steps.fake.js';
import { createChatLook } from '../chat-look.utils.js';
import { logLook } from '../log-look.utils.js';
import { Renderer } from '../render.service.js';
import type { Look } from '../render.types.js';

const main = sessionIdSchema.parse('main');

/** What a look prints for these events, without colour. */
function printed(params: { look: Look; events: EntryEvent[] }): string {
  let out = '';
  const renderer = new Renderer((text) => (out += text), params.look);

  for (const event of params.events) renderer.event(event);

  return stripVTControlCharacters(out);
}

describe('Renderer: a batch of tool calls, in the chat look', () => {
  const look = createChatLook();
  const chatted = (events: EntryEvent[]) => printed({ look, events });

  it('writes each step with its own result, in call order, not all titles first', () => {
    const [startA, resultA] = step('a', 'Check A');
    const [startB, resultB] = step('b', 'Check B');

    expect(chatted([startA, startB, batchOf(startA, startB), resultA, resultB])).toBe(
      '⏺ Check A  $ a\n  ⎿ ✓ 2 chars · 0.3s\n⏺ Check B  $ b\n  ⎿ ✓ 2 chars · 0.3s\n',
    );
  });

  it('keeps a step’s own title with a result that arrives ahead of the one before it', () => {
    const [startA] = step('a', 'Slow');
    const [startB, resultB] = step('b', 'Fast');

    expect(chatted([startA, startB, batchOf(startA, startB), resultB])).toBe(
      '⏺ Fast  $ b\n  ⎿ ✓ 2 chars · 0.3s\n',
    );
  });

  it('shows a lone call’s title as its batch starts, while it still runs', () => {
    const [startA] = step('a', 'Only');

    expect(chatted([startA])).toBe('');
    expect(chatted([startA, batchOf(startA)])).toBe('⏺ Only  $ a\n');
  });

  it('writes text the model streams after a call before that call’s title', () => {
    const [startA] = step('a', 'Only');
    const after: EntryEvent = { seq: 2, type: 'text_delta', text: 'after the call' };
    const out = chatted([startA, after, batchOf(startA)]);

    // The title waits for the batch, which comes once the model has stopped streaming.
    expect(out.indexOf('after the call')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('after the call')).toBeLessThan(out.indexOf('⏺ Only'));
  });

  it('still shows a title that never got its result when the run ends without one', () => {
    let out = '';
    const renderer = new Renderer((text) => (out += text), look);
    const [startA] = step('a', 'Cut off');

    renderer.event(startA);
    renderer.clearRunning();
    renderer.event({
      seq: 4,
      type: 'done',
      reason: 'interrupted',
      session: { id: main, rootId: main, depth: 1 },
    });

    expect(stripVTControlCharacters(out).match(/Cut off/g)).toHaveLength(1);
  });
});

describe('Renderer: a batch of tool calls, in the plain log', () => {
  it('keeps the start order, and labels each result with its step', () => {
    const [startA, resultA] = step('a', 'Check A');
    const [startB, resultB] = step('b', 'Check B');

    expect(
      printed({
        look: logLook,
        events: [startA, startB, batchOf(startA, startB), resultA, resultB],
      }),
    ).toBe(
      '\n⏺ Check A  $ a\n\n⏺ Check B  $ b\n  ⎿ 2 tools in parallel\n' +
        '    ✓ Check A · 2 chars · 0.3s\n    ✓ Check B · 2 chars · 0.3s\n',
    );
  });
});
