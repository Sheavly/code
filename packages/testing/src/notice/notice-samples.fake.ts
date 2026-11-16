import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import { harnessNoticeSchema } from '@sheavly/protocol/notice/notice.validator';

const FINISHED_AT = 900;

function finishedTask(id: string) {
  return {
    id,
    command: 'npm run build',
    description: 'Build the package',
    status: 'completed',
    startedAt: 400,
    endedAt: FINISHED_AT,
    output: 'built',
  };
}

function reportFrom(agentId: string) {
  const agent = { id: agentId, parentId: 'root', rootId: 'root', depth: 2, title: 'Check docs' };

  return {
    kind: 'agent-report',
    agent: { ...agent, startedByCall: 'call-9', state: 'completed', startedAt: 400, endedAt: 900 },
    outcome: 'completed',
    report: 'The docs agree',
  };
}

const AGENT_REPORT = reportFrom('agent-7');
const TASK_FINISHED = { kind: 'task-finished', task: finishedTask('task-7') };

/**
 * One valid notice of every kind, parsed through the contract so a sample can't drift. The `Record`
 * key makes adding a kind fail typecheck here until it has a sample, which is how every suite that
 * runs all kinds through one path (formatter, history, stream) picks the new kind up.
 */
export const NOTICE_SAMPLES: Record<HarnessNotice['kind'], HarnessNotice> = {
  'running-tasks': harnessNoticeSchema.parse({
    kind: 'running-tasks',
    tasks: [{ id: 'task-1', title: 'Run tests', reason: 'waiting', startedAt: 100 }],
    total: 1,
    omitted: 0,
  }),
  'context-usage': harnessNoticeSchema.parse({ kind: 'context-usage', context: { used: 10 } }),
  'output-continuation': harnessNoticeSchema.parse({ kind: 'output-continuation', attempt: 1 }),
  'agent-report': harnessNoticeSchema.parse(AGENT_REPORT),
  'task-finished': harnessNoticeSchema.parse(TASK_FINISHED),
  'tasks-finished': harnessNoticeSchema.parse({
    kind: 'tasks-finished',
    reason: 'Compare both results',
    notices: [AGENT_REPORT, TASK_FINISHED],
  }),
  'hook-failed': harnessNoticeSchema.parse({
    kind: 'hook-failed',
    hook: 'audit',
    handler: 'beforeTurn',
    error: 'boom',
  }),
};
