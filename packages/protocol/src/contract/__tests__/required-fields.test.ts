import { describe, expect, it } from 'vitest';
import { entryEventSchema } from '../../event/event.validator.js';
import { historyMessageSchema } from '../../history/history.validator.js';
import { storedConversationSchema } from '../../store/store.validator.js';
import { taskInfoSchema } from '../../task/task.validator.js';

const TASK = {
  id: 'task-1',
  command: 'npm run build',
  description: 'Build the package',
  kind: 'task',
  status: 'completed',
  startedAt: 400,
  endedAt: 900,
  output: 'built',
};
const CONTEXT = { reason: 'Use it', startedAt: 400, durationMs: 500, userMessagesSinceStart: 1 };
const AGENT_REPORT = {
  kind: 'agent-report',
  agent: {
    id: 'agent-1',
    parentId: 'root',
    rootId: 'root',
    startedByCall: 'call-1',
    depth: 2,
    title: 'Check docs',
    state: 'completed',
    startedAt: 400,
    endedAt: 900,
    lastOutcome: 'completed',
  },
  outcome: 'completed',
  report: 'The docs agree',
  context: CONTEXT,
};
const TASK_FINISHED = { kind: 'task-finished', task: TASK, context: CONTEXT };
const GROUP = {
  kind: 'tasks-finished',
  reason: 'Compare',
  notices: [AGENT_REPORT, TASK_FINISHED],
  context: CONTEXT,
};
const CHECKPOINT = {
  role: 'summary',
  sections: [],
  kept: 1,
  summarized: 2,
  covered: 3,
  summarizer: 'model',
};
const SUMMARY_FAILED = {
  seq: 0,
  type: 'summary_failed',
  reason: 'manual',
  kind: 'generation',
  error: 'boom',
  retriesLeft: 0,
};
const STORED = {
  id: '3f2b8a52-5c0e-4a0e-9a53-8f7f4b1c2d3e',
  title: 'A chat',
  modelId: '9d6c1a52-5c0e-4a0e-9a53-8f7f4b1c2d3e',
  mode: 'medium',
  workspace: '/work',
  profile: '1a2b3c4d-5c0e-4a0e-9a53-8f7f4b1c2d3e',
  status: 'closed',
  startedAt: 1,
  updatedAt: 2,
};

const without = (value: object, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const notice = (value: object) => ({ role: 'notice', notice: value });

/** Fields the contract requires: a payload without one is rejected. */
const CASES: [string, () => boolean, () => boolean][] = [
  [
    'a summary checkpoint names the entries it covers',
    () => historyMessageSchema.safeParse(CHECKPOINT).success,
    () => historyMessageSchema.safeParse(without(CHECKPOINT, 'covered')).success,
  ],
  [
    'a failed summary says which kind of failure it was',
    () => entryEventSchema.safeParse(SUMMARY_FAILED).success,
    () => entryEventSchema.safeParse(without(SUMMARY_FAILED, 'kind')).success,
  ],
  [
    'an agent report carries its completion context',
    () => historyMessageSchema.safeParse(notice(AGENT_REPORT)).success,
    () => historyMessageSchema.safeParse(notice(without(AGENT_REPORT, 'context'))).success,
  ],
  [
    'a finished task carries its completion context',
    () => historyMessageSchema.safeParse(notice(TASK_FINISHED)).success,
    () => historyMessageSchema.safeParse(notice(without(TASK_FINISHED, 'context'))).success,
  ],
  [
    'a finished group carries its completion context',
    () => historyMessageSchema.safeParse(notice(GROUP)).success,
    () => historyMessageSchema.safeParse(notice(without(GROUP, 'context'))).success,
  ],
  [
    'a task snapshot names its kind',
    () => taskInfoSchema.safeParse(TASK).success,
    () => taskInfoSchema.safeParse(without(TASK, 'kind')).success,
  ],
  [
    'a stored conversation records its mode',
    () => storedConversationSchema.safeParse(STORED).success,
    () => storedConversationSchema.safeParse(without(STORED, 'mode')).success,
  ],
];

describe('fields the contract no longer reads without', () => {
  it.each(CASES)('%s', (_title, complete, lacking) => {
    expect(complete()).toBe(true);
    expect(lacking()).toBe(false);
  });
});
