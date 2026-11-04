import { describe, expect, it } from 'vitest';
import { Renderer } from '../render.service.js';
import type { EntryEvent, ToolArtifact } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

const callId = callIdSchema.parse('1');
const main = sessionIdSchema.parse('main');

/** What the renderer prints for one successful `tool_result` with `artifacts`. */
function rendered(params: { content: string; artifacts?: ToolArtifact[] }): string {
  const { content, artifacts } = params;
  let out = '';
  const event: EntryEvent = {
    seq: 0,
    type: 'tool_result',
    call: { id: callId, name: 'tool', input: {} },
    description: 'doing it',
    message: { role: 'tool', toolCallId: callId, content, isError: false },
    durationMs: 1200,
    ...(artifacts && { artifacts }),
  };

  new Renderer(
    (text) => (out += text),
    () => 0,
  ).event(event);

  return out;
}

describe('Renderer: entries', () => {
  const text = (sessionId: string, seq: number): StreamEntry => ({
    seq,
    at: 0,
    sessionId: sessionIdSchema.parse(sessionId),
    kind: 'event',
    event: { seq, type: 'text_delta', text: `from ${sessionId}` },
  });

  it('prints the main session’s events, not a sub-agent’s', () => {
    let out = '';
    const renderer = new Renderer(
      (written) => (out += written),
      () => 0,
    );

    renderer.entry(text('main', 0), main);
    renderer.entry(text('child', 1), main);
    expect(out).toBe('from main');
  });

  it('says how many background tasks a finished turn still waits for', () => {
    let out = '';
    const renderer = new Renderer(
      (written) => (out += written),
      () => 2,
    );

    renderer.event({ seq: 0, type: 'turn_end', turn: 1, stopReason: 'end_turn' });
    expect(out).toContain('waiting for 2 background task(s)');
  });
});

describe('Renderer: tool results', () => {
  it("names a file change by the tool's summary", () => {
    const change = { kind: 'file_change', path: 'a.ts', before: null, after: 'x' };

    expect(rendered({ content: 'Created a.ts (0 → 1 lines)', artifacts: [change] })).toBe(
      '    ✓ Created a.ts (0 → 1 lines) · 1.2s\n',
    );
  });

  it('describes a read by the range it covered', () => {
    const read = {
      kind: 'file_read',
      path: 'a.ts',
      startLine: 10,
      endLine: 40,
      totalLines: 900,
      whole: false,
    };

    expect(rendered({ content: 'x'.repeat(50), artifacts: [read] })).toBe(
      '    ✓ read a.ts lines 10–40 (of 900) · 1.2s\n',
    );
  });

  it('skips artifacts it does not know, and shows the size of the text', () => {
    expect(rendered({ content: 'Parsed', artifacts: [{ kind: 'table', rows: 1 }] })).toBe(
      '    ✓ 6 chars · 1.2s\n',
    );
    expect(rendered({ content: 'Parsed' })).toBe('    ✓ 6 chars · 1.2s\n');
  });
});
