import { describe, expect, it } from 'vitest';
import { entryEventSchema } from '@sheavly/protocol/event/event.validator';
import { toolResultOutputs } from '../check.utils.js';

describe('recorded tool output', () => {
  it('separates failed results from success and ignores assistant claims', () => {
    const result = (content: string, isError: boolean) =>
      entryEventSchema.parse({
        seq: 0,
        type: 'tool_result',
        call: { id: 'check', name: 'run_command', input: { command: 'node check.mjs' } },
        description: 'Run check',
        message: { role: 'tool', toolCallId: 'check', content, isError },
        durationMs: 1,
      });
    const claim = entryEventSchema.parse({ seq: 0, type: 'text_delta', text: 'INVOICE_CHECK_OK' });

    expect(toolResultOutputs([claim, result('INVOICE_CHECK_OK', true)])).toEqual({
      toolResults: {},
      toolErrors: { run_command: 'INVOICE_CHECK_OK' },
    });
    expect(toolResultOutputs([result('first', false), claim, result('second', false)])).toEqual({
      toolResults: { run_command: 'first\nsecond' },
      toolErrors: {},
    });
  });
});
