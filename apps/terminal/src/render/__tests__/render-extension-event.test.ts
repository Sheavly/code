import { describe, expect, it } from 'vitest';
import { entryEventSchema } from '@sheavly/protocol/event/event.validator';
import { createChatLook } from '../chat-look.utils.js';
import { logLook } from '../log-look.utils.js';
import { Renderer } from '../render.service.js';

function extensionEvent(overrides: Record<string, unknown> = {}) {
  return entryEventSchema.parse({
    seq: 0,
    type: 'extension_event',
    extension: 'acme',
    kind: 'acme.deploy-finished',
    version: 1,
    data: { secretPayload: 'DATA-ONLY-MARKER' },
    text: 'Deploy finished',
    ...overrides,
  });
}

const ESCAPE = String.fromCodePoint(27);
const COLOUR_CODE = new RegExp(`${ESCAPE}\\[\\d+m`, 'g');

/** What the look itself painted is removed, so any escape left came from the event's text. */
const unpainted = (output: string) => output.replaceAll(COLOUR_CODE, '');

describe.each([
  { name: 'chat', look: createChatLook() },
  { name: 'log', look: logLook },
])('Renderer: extension events ($name)', ({ look }) => {
  function render(event: ReturnType<typeof extensionEvent>): string {
    const out: string[] = [];
    const renderer = new Renderer((chunk) => out.push(chunk), look);

    renderer.event(event);

    return out.join('');
  }

  it('shows the fallback text, prefixed with the extension name, and nothing of data', () => {
    const output = render(extensionEvent());

    expect(output).toContain('acme: Deploy finished');
    expect(output).not.toContain('DATA-ONLY-MARKER');
  });

  it('shows the fallback of a kind it has never heard of', () => {
    const output = render(extensionEvent({ extension: 'other', kind: 'other.thing', text: 'Hi' }));

    expect(output).toContain('other: Hi');
  });

  it('neutralises control characters and escape sequences in the text', () => {
    const output = unpainted(
      render(extensionEvent({ text: 'a\u001b[31mred\u001b]0;title\u0007\u0000b' })),
    );

    expect(output).not.toContain('\u001b');
    expect(output).not.toContain('\u0007');
    expect(output).not.toContain('\u0000');
    expect(output).toContain('\\u001b[31mred\\u001b]0;title\\u0007\\u0000b');
  });

  it('keeps a multi-line text on one line, so it cannot imitate other output', () => {
    const output = unpainted(render(extensionEvent({ text: 'first\n✓ t1 completed\n\nlast' })));

    expect(output.trim().split('\n')).toHaveLength(1);
    expect(output).toContain('first ✓ t1 completed last');
  });

  it('does not end or restart the reply: the text it interrupts carries on', () => {
    const out: string[] = [];
    let ended = 0;
    const renderer = new Renderer((chunk) => out.push(chunk), look, {
      write: (chunk) => out.push(chunk),
      end: () => ended++,
    });

    renderer.event({ seq: 0, type: 'text_delta', text: 'partial ' });
    renderer.event(extensionEvent());
    renderer.event({ seq: 1, type: 'text_delta', text: 'rest' });

    expect(ended).toBe(0);
    expect(out.join('')).toContain('rest');
  });
});
