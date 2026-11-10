import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { Renderer } from '../render.service.js';

const report = 'REPORT-BEGIN\n'.concat('Finding: e\n'.repeat(900), 'REPORT-END');

/** What the renderer prints for one `harness_notice` event. */
function printed(notice: unknown): string {
  let output = '';
  const renderer = new Renderer(
    (text) => (output += text),
    () => 0,
  );
  const event: EntryEvent = {
    seq: 0,
    type: 'harness_notice',
    notice: harnessNoticeSchema.parse(notice),
  };

  renderer.event(event);

  return output;
}

describe('Renderer: persistent notices', () => {
  it('ignores a finished task, since the task line already shows the finish', () => {
    expect(
      printed({
        kind: 'task-finished',
        task: {
          id: 't1',
          command: 'npm test',
          description: 'tests',
          status: 'completed',
          exitCode: 0,
          startedAt: 1,
          endedAt: 2,
          output: report,
        },
      }),
    ).toBe('');
  });

  it('ignores a sub-agent report, whose own session updates already draw its card', () => {
    const sessionFields = { id: 'sub-9', parentId: 'root', rootId: 'root', depth: 3 };
    const agent = { ...sessionFields, startedByCall: 'call-7', title: 'Audit', startedAt: 5 };

    expect(
      printed({
        kind: 'agent-report',
        agent: { ...agent, state: 'completed' },
        taskId: 't2',
        outcome: 'completed',
        report,
      }),
    ).toBe('');
  });
});
