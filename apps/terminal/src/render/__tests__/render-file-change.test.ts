// A hook can append a long report (lint problems, rules) to a file tool's result for the model.
// The terminal shows the tool's own line and how much more there is, never the whole report.
import { describe, expect, it } from 'vitest';
import { Renderer } from '../render.service.js';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const callId = callIdSchema.parse('1');
const change = { kind: 'file_change', path: 'a.ts', before: null, after: 'x' };
const report = `ESLint found problems:\n${'a.ts:1:1 problem\n'.repeat(40)}`;

/** What the renderer prints for one successful file-change `tool_result` with this content. */
function rendered(content: string): string {
  let out = '';
  const event: EntryEvent = {
    seq: 0,
    type: 'tool_result',
    call: { id: callId, name: 'edit_file', input: {} },
    description: 'editing',
    message: { role: 'tool', toolCallId: callId, content, isError: false },
    durationMs: 1200,
    artifacts: [change],
  };

  new Renderer(
    (text) => (out += text),
    () => 0,
  ).event(event);

  return out;
}

describe('Renderer: a file change whose result a hook added a report to', () => {
  it("shows the tool's own line and how many lines the model got besides", () => {
    expect(rendered(`Created a.ts (0 → 1 lines)\n\n${report}`)).toBe(
      '    ✓ Created a.ts (0 → 1 lines) · +41 lines for the model · 1.2s\n',
    );
  });

  it('keeps the line count of a long path, which a cut would have dropped', () => {
    const long = `${'deep/'.repeat(30)}file.ts`;

    expect(rendered(`Edited ${long} (12 → 13 lines)\n\n${report}`)).toContain(
      `${long} (12 → 13 lines)`,
    );
  });

  it('skips a leading blank line and shows control characters visibly', () => {
    const out = rendered('\n\nCreated a\u202Eb.ts (0 → 1 lines)');

    expect(out).toContain('Created a');
    expect(out).not.toContain('\u202E');
  });

  it('shows a result with no report as it was', () => {
    expect(rendered('Created a.ts (0 → 1 lines)')).toBe(
      '    ✓ Created a.ts (0 → 1 lines) · 1.2s\n',
    );
  });
});
