import { describe, expect, it, vi } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';
import { createChatLook } from '../chat-look.utils.js';
import { logLook } from '../log-look.utils.js';
import { Renderer } from '../render.service.js';

const report = 'REPORT-BEGIN\n'.concat('Finding: e\n'.repeat(900), 'REPORT-END');
const callId = callIdSchema.parse('call-7');
const taskFinished = {
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
};
const agentReport = {
  kind: 'agent-report',
  agent: {
    id: 'sub-9',
    parentId: 'root',
    rootId: 'root',
    depth: 3,
    startedByCall: callId,
    title: 'Audit',
    startedAt: 5,
    state: 'completed',
  },
  taskId: 't2',
  outcome: 'completed',
  report,
};
const context = {
  reason: 'Run the tests before reviewing the findings',
  startedAt: 1_700_000_000_000,
  durationMs: 1_250,
  userMessagesSinceStart: 2,
  callId,
};
const enrichedTask = {
  ...taskFinished,
  task: { ...taskFinished.task, reason: context.reason },
  context,
};
const enrichedAgent = {
  ...agentReport,
  context: {
    reason: 'Audit the changes',
    startedAt: 1_700_000_000_000,
    durationMs: 0,
    userMessagesSinceStart: 0,
  },
};
const cases = [
  { name: 'legacy task-finished', notice: taskFinished },
  { name: 'legacy agent-report', notice: agentReport },
  {
    name: 'legacy tasks-finished',
    notice: {
      kind: 'tasks-finished',
      reason: 'Collect the results',
      notices: [taskFinished, agentReport],
    },
  },
  { name: 'enriched task-finished', notice: enrichedTask },
  { name: 'enriched agent-report without a context callId', notice: enrichedAgent },
  {
    name: 'enriched tasks-finished with context on each member',
    notice: {
      kind: 'tasks-finished',
      reason: 'Collect the results',
      notices: [enrichedTask, enrichedAgent],
    },
  },
];

describe.each([
  { name: 'chat', look: createChatLook() },
  { name: 'log', look: logLook },
])('Renderer: persistent notices ($name)', ({ look }) => {
  it.each(cases)('ignores $name without changing output or progress', ({ notice }) => {
    const write = vi.fn();
    const reply = { write: vi.fn(), end: vi.fn() };
    const runningTasks = vi.fn(() => 1);
    const renderer = new Renderer(write, runningTasks, look, reply);
    const event: EntryEvent = {
      seq: 3,
      type: 'harness_notice',
      notice: harnessNoticeSchema.parse(notice),
    };

    // Existing task/session updates own progress; notices must not clear or redraw it.
    renderer.event({
      seq: 0,
      type: 'tool_call_started',
      call: { id: callId, name: 'run_command', input: { command: 'npm test' } },
      description: 'tests',
    });
    renderer.event({ seq: 1, type: 'reasoning_activity', active: true });
    renderer.event({ seq: 2, type: 'text_delta', text: 'First ' });
    const running = renderer.running;

    write.mockClear();
    reply.write.mockClear();
    renderer.event(event);

    expect(write).not.toHaveBeenCalled();
    expect(reply.write).not.toHaveBeenCalled();
    expect(reply.end).not.toHaveBeenCalled();
    expect(runningTasks).not.toHaveBeenCalled();
    expect(renderer.running).toBe(running);
    expect(renderer.running).toHaveLength(1);
    expect(renderer.thinking).toBe(true);
    expect(event.notice).toEqual(notice);

    renderer.event({ seq: 4, type: 'text_delta', text: 'part.' });

    expect(write).not.toHaveBeenCalled();
    expect(reply.write.mock.calls).toEqual([['part.']]);
    expect(reply.end).not.toHaveBeenCalled();
  });
});
