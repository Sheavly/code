import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { agentEventSchema } from '@sheavly/protocol/event/event.validator';
import { sessionUpdateSchema } from '@sheavly/protocol/session/session.validator';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { startTaskTool } from '@sheavly/runtime/testing/start-task.fake';
import { streamAgent } from '../stream-agent.helper.js';

// What the loop and the session registry send is what @sheavly/protocol describes: every event of
// a real (scripted) run parses against its schema and comes out unchanged.

let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

const diff = defineTool({
  name: 'diff',
  description: 'Returns text for the model and an artifact for the UI',
  inputSchema: z.object({}),
  execute: async () => ({
    content: 'changed a.ts',
    artifacts: [{ kind: 'file_change', path: 'a.ts', before: 'a', after: 'b' }],
  }),
});
const failing = defineTool({
  name: 'failing',
  description: 'Always fails',
  inputSchema: z.object({}),
  execute: async () => {
    throw new Error('nope');
  },
});
const context = defineHook({
  name: 'context',
  beforeTurn: async ({ addContext }) => {
    addContext('project rules');
  },
});

const call = (id: string, name: string, input: object = {}): StreamEvent => ({
  type: 'tool_call',
  call: { id: callIdSchema.parse(id), name, input: { description: `calling ${name}`, ...input } },
});

/** Turn 1: reasoning, text and three calls (artifacts, an error, a background task). Turn 2: an answer. */
const script: StreamEvent[][] = [
  [
    { type: 'reasoning', item: { source: 'test', data: { encrypted: 'x' } } },
    { type: 'text_delta', text: 'Working. ' },
    call('1', 'diff'),
    call('2', 'failing'),
    call('3', 'start_task', { ms: 1 }),
    { type: 'done', stopReason: 'tool_use' },
  ],
  [
    { type: 'text_delta', text: 'Done.' },
    { type: 'done', stopReason: 'end_turn' },
  ],
];

async function run(): Promise<{ events: AgentEvent[]; updates: SessionUpdate[] }> {
  tasks = new TaskRegistry();
  const registry = new SessionRegistry();
  const updates: SessionUpdate[] = [];
  const events: AgentEvent[] = [];

  registry.subscribe((update) => updates.push(update));
  const ref = registry.startMain({ title: 'Main' });

  for await (const event of streamAgent({
    provider: scriptedProvider(script),
    tools: [diff, failing, startTaskTool(tasks)],
    messages: [{ role: 'user', content: 'go' }],
    tasks,
    hooks: [context],
    session: { registry, ref },
  })) {
    events.push(event);
  }

  return { events, updates };
}

describe('the wire contract', () => {
  it('describes every event a scripted run emits', async () => {
    const { events } = await run();

    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set([
        'context_added',
        'reasoning',
        'text_delta',
        'usage',
        'tool_call_started',
        'turn_end',
        'tool_batch',
        'tool_result',
        'task_running',
        'done',
      ]),
    );
    for (const event of events) expect(agentEventSchema.parse(event)).toEqual(event);
  });

  it('describes the session updates the run causes', async () => {
    const { updates } = await run();

    expect(updates.map((update) => update.type)).toEqual(
      expect.arrayContaining(['session_started', 'session_ended']),
    );
    for (const update of updates) expect(sessionUpdateSchema.parse(update)).toEqual(update);
  });
});
