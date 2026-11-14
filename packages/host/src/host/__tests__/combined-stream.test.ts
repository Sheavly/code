import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { createSubAgentTool } from '@sheavly/tools/sub-agent/sub-agent.tool';
import { createHarness } from '../host.helper.js';
import {
  calls,
  routedProvider,
  say,
  toolCall,
} from '@sheavly/testing/provider/routed-provider.fake';
import { streamEntrySchema } from '@sheavly/protocol/stream/stream.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

const call = (id: string, name: string, input: Record<string, unknown>) =>
  toolCall({ id, name, input });
const toolUse: StreamEvent = { type: 'done', stopReason: 'tool_use' };

/**
 * The main session starts two sub-agents at once; the first starts one of its own. Every
 * session's events and updates are collected from the registry's combined stream.
 */
async function runTree(): Promise<{ sessions: SessionRegistry; entries: StreamEntry[] }> {
  const entries: StreamEntry[] = [];
  const provider = routedProvider({
    Main: [
      () => [
        call('a', 'start_agent', { title: 'A', task: 'Task A' }),
        call('b', 'start_agent', { title: 'B', task: 'Task B' }),
        toolUse,
      ],
      say('main done'),
    ],
    'Task A': [calls(call('a1', 'start_agent', { title: 'A1', task: 'Task A1' })), say('a done')],
    'Task B': [calls(call('b1', 'report_status', { status: 'working on b' })), say('b done')],
    'Task A1': [say('a1 done')],
  });
  // The harness wires tasks and approvals into the stream; the tree runs on its registries.
  const { sessions, tasks, mainSession: main } = createHarness({ provider, title: 'Main' });

  sessions.subscribeEntries((entry) => entries.push(entry), { replay: true });

  const startAgent = createSubAgentTool({
    sessions,
    tasks,
    provider,
    runAgent: runSession,
    tools: [],
  });

  await runSession({
    provider,
    tools: [startAgent],
    messages: [{ role: 'user', content: 'Main' }],
    tasks,
    session: { registry: sessions, ref: main },
  });

  return { sessions, entries };
}

/**
 * Every session the stream announced, in the order they started. A delivered sub-agent is released
 * from the registry, so the stream is where the whole tree stays.
 */
function startedSessions(entries: StreamEntry[]) {
  return entries.flatMap((entry) =>
    entry.kind === 'update' && entry.update.type === 'session_started'
      ? [entry.update.session]
      : [],
  );
}

/** Where in the combined stream the first entry matching `match` is. */
const indexOf = (entries: StreamEntry[], match: (entry: StreamEntry) => boolean) =>
  entries.findIndex(match);

describe("the combined stream of a run's sessions", () => {
  it('has every session’s events and updates, valid entries, with one seq with no gaps', async () => {
    const { sessions, entries } = await runTree();
    const ids = new Set(startedSessions(entries).map((session) => session.id));

    expect(startedSessions(entries).map((session) => session.title)).toEqual([
      'Main',
      'A',
      'B',
      'A1',
    ]);
    // Every delivered sub-agent was released; only the main session is still in the registry.
    expect(sessions.list().map((session) => session.title)).toEqual(['Main']);
    expect(entries.map((entry) => entry.seq)).toEqual(entries.map((_, index) => index));

    for (const entry of entries) {
      expect(streamEntrySchema.parse(entry)).toEqual(entry);
      expect(ids.has(entry.sessionId)).toBe(true);
    }

    // Every session's loop events are all there, in its own order, ending with its done.
    for (const id of ids) {
      const own = entries.flatMap((entry) =>
        entry.kind === 'event' && entry.sessionId === id ? [entry.event] : [],
      );

      expect(own.map((event) => event.seq)).toEqual(own.map((_, index) => index));
      expect(own.at(-1)?.type).toBe('done');
      // The history isn't in the stream: each done would otherwise hold the whole conversation.
      expect(own.at(-1)).not.toHaveProperty('messages');
    }
  });

  it('puts each sub-agent after the call that started it, and both siblings run at once', async () => {
    const { entries } = await runTree();
    const byTitle = Object.fromEntries(startedSessions(entries).map((s) => [s.title, s.id]));
    const started = (title: string) =>
      indexOf(
        entries,
        (e) =>
          e.kind === 'update' &&
          e.update.type === 'session_started' &&
          e.sessionId === byTitle[title],
      );
    const ended = (title: string) =>
      indexOf(
        entries,
        (e) =>
          e.kind === 'update' &&
          e.update.type === 'session_ended' &&
          e.sessionId === byTitle[title],
      );
    const callStarted = (session: string, callId: string) =>
      indexOf(
        entries,
        (e) =>
          e.kind === 'event' &&
          e.sessionId === byTitle[session] &&
          e.event.type === 'tool_call_started' &&
          e.event.call.id === callId,
      );

    expect(callStarted('Main', 'a')).toBeLessThan(started('A'));
    expect(callStarted('Main', 'b')).toBeLessThan(started('B'));
    expect(callStarted('A', 'a1')).toBeLessThan(started('A1'));
    // B started before A (and its own sub-agent) finished: the siblings overlapped.
    expect(started('B')).toBeLessThan(ended('A'));
    expect(ended('A1')).toBeLessThan(ended('A'));
    expect(ended('A')).toBeLessThan(ended('Main'));
  });

  it('files each sub-agent’s task under the session that started it, started then ended', async () => {
    const { entries } = await runTree();
    const byTitle = Object.fromEntries(startedSessions(entries).map((s) => [s.title, s.id]));
    const taskEntries = entries.flatMap((entry) =>
      entry.kind === 'task'
        ? [
            {
              session: entry.sessionId,
              type: entry.update.type,
              command: entry.update.task.command,
            },
          ]
        : [],
    );

    for (const [title, parent] of [
      ['A', 'Main'],
      ['B', 'Main'],
      ['A1', 'A'],
    ] as const) {
      const own = taskEntries.filter(({ command }) => command === `sub-agent: ${title}`);

      expect(own).toEqual([
        { session: byTitle[parent], type: 'task_started', command: `sub-agent: ${title}` },
        { session: byTitle[parent], type: 'task_ended', command: `sub-agent: ${title}` },
      ]);
    }
  });
});
