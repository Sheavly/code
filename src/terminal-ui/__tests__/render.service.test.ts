import { describe, expect, it } from 'vitest';
import type { ToolArtifact } from '@sheavly/core/tool/tool.types';
import type { AgentEvent } from '../../loop/events/events.types.js';
import { TaskRegistry } from '../../runtime/tasks/tasks.service.js';
import { Renderer } from '../render.service.js';

/** What the renderer prints for one successful `tool_result` with `artifacts`. */
function rendered(params: { content: string; artifacts?: ToolArtifact[] }): string {
  const { content, artifacts } = params;
  let out = '';
  const event: AgentEvent = {
    seq: 0,
    type: 'tool_result',
    call: { id: '1', name: 'tool', input: {} },
    description: 'doing it',
    message: { role: 'tool', toolCallId: '1', content, isError: false },
    durationMs: 1200,
    ...(artifacts && { artifacts }),
  };

  new Renderer((text) => (out += text), new TaskRegistry()).event(event);

  return out;
}

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
