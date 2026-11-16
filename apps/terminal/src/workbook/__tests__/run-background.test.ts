import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { taskInfoSchema } from '@sheavly/protocol/task/task.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import { WorkbookStore } from '../store.service.js';
import { runWorkbook } from '../run.helper.js';
import {
  fakeRunRequest,
  fakeConversationDetails,
  useWorkbookRunEnvironment,
  FAKE_CONVERSATION,
  FAKE_MAIN_SESSION,
} from '../../testing/workbook-run.fake.js';
import { connectBackend } from '../../client/backend.helper.js';

// The same two replacements every workbook run test makes: the backend, and Git.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));
vi.mock('../../client/backend.helper.js', () => ({ connectBackend: vi.fn() }));

const id = FAKE_CONVERSATION;
const main = FAKE_MAIN_SESSION;
const request = fakeRunRequest('Start a background check, then finish');
const environment = useWorkbookRunEnvironment();
const task = {
  id: 't1',
  command: 'sleep 1',
  description: 'a background check',
  kind: 'task',
  status: 'running',
  startedAt: 0,
  output: '',
};
const taskEntry = (params: { seq: number; ended: boolean }): StreamEntry => ({
  seq: params.seq,
  at: 0,
  sessionId: main,
  kind: 'task',
  update: params.ended
    ? {
        type: 'task_ended',
        task: taskInfoSchema.parse({ ...task, status: 'completed', endedAt: 1, exitCode: 0 }),
      }
    : { type: 'task_started', task: taskInfoSchema.parse(task) },
});

const textEntry = (seq: number, text = 'WOKEN_REPLY'): StreamEntry => ({
  seq,
  at: 0,
  sessionId: main,
  kind: 'event',
  event: { seq, type: 'text_delta', text },
});

const done = (seq: number): StreamEntry => ({
  seq,
  at: 0,
  sessionId: main,
  kind: 'event',
  event: {
    seq,
    type: 'done',
    reason: 'completed',
    session: { id: main, rootId: main, depth: 1 },
  },
});

/**
 * A backend that ends the prompt while a command still runs, as the real one does when the model
 * stops without `await_tasks`. The run it then starts to deliver the finished command reaches a UI
 * only through the live feed, which is the one that does not carry the prompt.
 */
async function backendThatWakes(options: { outOfOrder?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'workbook-background-'));

  environment.keep(root);

  const store = new WorkbookStore(path.join(root, 'workbook'));
  const liveEnded = Promise.withResolvers<undefined>();
  const server = fakeServer({
    startConversation: () => ({ id }),
    getConversation: () => fakeConversationDetails(store.runWorkspaceDir(request.name)),
    async *sendPrompt() {
      yield taskEntry({ seq: 1, ended: false });

      if (options.outOfOrder) {
        // The two streams are not ordered against each other: this earlier entry reaches the run
        // after the live feed has already delivered a later one.
        await sleep(150);
        yield textEntry(2, 'EARLIER_ENTRY');
        yield done(3);

        return;
      }

      yield done(2);
    },
    async *streamConversation({ body }) {
      if (!(body as { replay?: boolean }).replay) {
        if (options.outOfOrder) yield textEntry(4, 'LATER_ENTRY_FIRST');

        // The command finishes after the prompt ended, and the backend starts a run to deliver it.
        await sleep(300);
        yield taskEntry({ seq: 5, ended: true });
        yield textEntry(6);
        yield done(7);
      }

      await liveEnded.promise;
    },
    getMessages: () => ({ messages: [] }),
    closeConversation: () => {
      liveEnded.resolve(undefined);
    },
    stopPrompt: () => undefined,
  });

  vi.mocked(connectBackend).mockResolvedValue({
    url: 'http://fake.test',
    token: 'fake',
    fetch: async (input, init) => {
      init?.signal?.addEventListener('abort', () => liveEnded.resolve(undefined), { once: true });

      return server.fetch(input, init);
    },
    stop: vi.fn(async () => undefined),
  });

  return { store };
}

describe('a run whose prompt ends while background work still runs', () => {
  it('records the run the backend starts to deliver the finished work', async () => {
    const { store } = await backendThatWakes();
    const result = await runWorkbook({ store, request });

    // The prompt's own stream carried a task start and one `done`. The woken run's text and its
    // `done` came later, on the live feed: without following it they are never recorded.
    expect(result.outcome).toBe('completed');
    expect(result.events).toBe(3);
    expect(result.lastEvent).toBe('#7 done');
  });

  it('shows an earlier entry that arrives after a later one from the other stream', async () => {
    const { store } = await backendThatWakes({ outOfOrder: true });
    const result = await runWorkbook({ store, request });
    const transcript = await readFile(store.paths(result.id).transcript, 'utf8');

    // A high-water mark on seq would drop EARLIER_ENTRY: the live feed had already shown seq 4.
    expect(transcript).toContain('LATER_ENTRY_FIRST');
    expect(transcript).toContain('EARLIER_ENTRY');
  });

  it('shows each entry once although the prompt and the live feed can both carry it', async () => {
    const { store } = await backendThatWakes();
    const result = await runWorkbook({ store, request });
    const transcript = await readFile(store.paths(result.id).transcript, 'utf8');

    expect(transcript.split('WOKEN_REPLY')).toHaveLength(2);
  });
});
