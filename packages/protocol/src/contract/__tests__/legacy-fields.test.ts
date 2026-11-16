import { describe, expect, it } from 'vitest';
import { entryEventSchema } from '../../event/event.validator.js';
import { historyMessageSchema, historyRecordSchema } from '../../history/history.validator.js';
import { storedConversationSchema } from '../../store/store.validator.js';
import { taskInfoSchema } from '../../task/task.validator.js';
import { LEGACY_FIELDS } from '../contract.constants.js';

const TASK = {
  id: 'task-1',
  command: 'npm test',
  description: 'Run tests',
  status: 'completed',
  startedAt: 100,
  endedAt: 200,
  output: 'ok',
};
const AGENT = {
  id: 'agent-1',
  parentId: 'main',
  rootId: 'main',
  startedByCall: 'call-1',
  depth: 2,
  title: 'Review tests',
  state: 'completed',
  startedAt: 100,
  endedAt: 200,
};
const AGENT_REPORT = {
  kind: 'agent-report',
  agent: AGENT,
  outcome: 'completed',
  report: 'All tests passed',
};
const TASK_FINISHED = { kind: 'task-finished', task: TASK };

/** What stored data looked like before each legacy field existed: valid without it. */
const WITHOUT_FIELD: Record<(typeof LEGACY_FIELDS)[number]['field'], () => unknown> = {
  'user message id': () => historyMessageSchema.parse({ role: 'user', content: 'hi', at: 1 }),
  'message at': () => historyMessageSchema.parse({ role: 'user', content: 'hi' }),
  'summary covered': () =>
    historyMessageSchema.parse({
      role: 'summary',
      sections: [],
      kept: 1,
      summarized: 2,
      summarizer: 'model',
    }),
  'summary incorporated': () =>
    historyMessageSchema.parse({
      role: 'summary',
      sections: [],
      kept: 1,
      summarized: 2,
      covered: 3,
      summarizer: 'model',
    }),
  'summary_failed kind': () =>
    entryEventSchema.parse({
      seq: 0,
      type: 'summary_failed',
      reason: 'manual',
      error: 'boom',
      retriesLeft: 0,
    }),
  'agent-report context': () =>
    historyMessageSchema.parse({ role: 'notice', notice: AGENT_REPORT }),
  'task-finished context': () =>
    historyMessageSchema.parse({ role: 'notice', notice: TASK_FINISHED }),
  'tasks-finished context': () =>
    historyMessageSchema.parse({
      role: 'notice',
      notice: { kind: 'tasks-finished', reason: 'both', notices: [AGENT_REPORT, TASK_FINISHED] },
    }),
  'task kind': () => taskInfoSchema.parse(TASK),
  'stored conversation mode': () =>
    storedConversationSchema.parse({
      id: '3f2b8a52-5c0e-4a0e-9a53-8f7f4b1c2d3e',
      title: 'Old chat',
      modelId: '9d6c1a52-5c0e-4a0e-9a53-8f7f4b1c2d3e',
      workspace: '/work',
      profile: '1a2b3c4d-5c0e-4a0e-9a53-8f7f4b1c2d3e',
      status: 'closed',
      startedAt: 1,
      updatedAt: 2,
    }),
};

describe('legacy wire fields', () => {
  it('lists a removal condition for every legacy field', () => {
    for (const { field, removeWhen } of LEGACY_FIELDS) {
      expect(removeWhen.length, field).toBeGreaterThan(10);
    }
  });

  it('has a reading check for exactly the fields it lists', () => {
    expect(Object.keys(WITHOUT_FIELD).sort()).toEqual(LEGACY_FIELDS.map((f) => f.field).sort());
  });

  it.each(LEGACY_FIELDS.map((legacy) => legacy.field))(
    'still reads data written without the %s',
    (field) => {
      expect(() => WITHOUT_FIELD[field]()).not.toThrow();
    },
  );

  it('opens a whole conversation stored before any of them existed', () => {
    const stored = [
      { role: 'user', content: 'run the tests' },
      { role: 'assistant', content: '', toolCalls: [] },
      { role: 'notice', notice: TASK_FINISHED },
      {
        role: 'summary',
        sections: [],
        kept: 1,
        summarized: 3,
        summarizer: 'model',
      },
    ];

    const records = stored.map((entry, seq) => historyRecordSchema.parse({ seq, entry }));

    expect(records.map((record) => record.entry)).toEqual(stored);
  });
});
