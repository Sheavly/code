import { describe, expect, it } from 'vitest';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import type { ModelMode } from '@sheavly/protocol/model/model.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
import { ChatSession } from '../chat-session.service.js';
import type { ChatConversation } from '../chat.types.js';

const MAIN = sessionIdSchema.parse('main');
const FAST = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
const DEEP = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');
const models: ModelChoice[] = [
  { id: FAST, name: 'Fast', adapter: 'openai', model: 'gpt-fast' },
  { id: DEEP, name: 'Deep', adapter: 'openai', model: 'gpt-deep' },
];

const text = (value: string): StreamEntry => ({
  seq: 0,
  at: 0,
  sessionId: MAIN,
  kind: 'event',
  event: { seq: 0, type: 'text_delta', text: value },
});

/**
 * A conversation whose prompts the test finishes by hand, so it can look at what the chat does
 * while one is still running.
 */
function fakeConversation(params: { skills: string[]; failOn: string | undefined }) {
  const { skills, failOn } = params;
  const sent: string[] = [];
  const open: { release: () => void; signal: AbortSignal | undefined }[] = [];
  let model = FAST;
  const modes = new Map<string, ModelMode>();

  const conversation: ChatConversation = {
    runningTasks: 0,
    skills: () =>
      Promise.resolve(
        skills.map((name) => ({
          name,
          description: '',
          manualOnly: false,
          scope: 'project' as const,
        })),
      ),
    details: () =>
      Promise.resolve({
        model: {
          ...models.find((choice) => choice.id === model),
          mode: modes.get(model) ?? 'medium',
        },
        models,
      } as never),
    useModel: (id, mode) => {
      if (!models.some((choice) => choice.id === id)) return Promise.resolve(false);
      model = id;
      if (mode) modes.set(id, mode);

      return Promise.resolve(true);
    },
    async *send({ text: sentText, signal }) {
      sent.push(sentText);
      if (sentText === failOn) throw new Error('the backend went away');
      await new Promise<void>((resolve) => {
        open.push({ release: resolve, signal });
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      yield text(`answer to ${sentText}`);
    },
  };

  return { conversation, sent, open, model: () => model };
}

function chat(extra: { skills?: string[]; failOn?: string } = {}) {
  const fake = fakeConversation({ skills: extra.skills ?? [], failOn: extra.failOn });
  const written: string[] = [];
  const queues: string[][] = [];
  let exited = 0;
  const renderer = new Renderer(
    (out) => written.push(out),
    () => 0,
  );
  const session = new ChatSession({
    conversation: fake.conversation,
    renderer,
    mainSession: MAIN,
    write: (out) => written.push(out),
    onQueue: (queue) => queues.push([...queue]),
    onExit: () => (exited += 1),
  });

  return {
    session,
    renderer,
    fake,
    written,
    queues,
    exited: () => exited,
    output: () => written.join(''),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('ChatSession: file changes', () => {
  const keepTwo = (renderer: Renderer) => {
    renderer.changes.keep({ kind: 'file_change', path: 'a.ts', before: 'a\n', after: 'b\n' });
    renderer.changes.keep({ kind: 'file_change', path: 'c.ts', before: null, after: 'x\n' });
  };

  it('answers /changes without sending it, and lists the files changed', async () => {
    const { session, renderer, fake, output } = chat();

    keepTwo(renderer);
    session.submit('/changes');
    await session.idle();

    expect(fake.sent).toEqual([]);
    expect(output()).toContain('2 files, 2 edits');
  });

  it('shows the diff /changes names, a file’s with spaces in its path included', async () => {
    const { session, renderer, output } = chat();

    renderer.changes.keep({
      kind: 'file_change',
      path: 'my docs/a.md',
      before: null,
      after: 'x\n',
    });
    session.submit('/changes my docs/a.md');
    await session.idle();

    expect(output()).toContain('my docs/a.md');
    expect(output()).toContain('+ x');
  });

  it('draws what /changes and /errors print in the palette it was given', () => {
    const renderer = new Renderer(
      () => undefined,
      () => 0,
    );
    const session = new ChatSession({
      conversation: fakeConversation({ skills: [], failOn: undefined }).conversation,
      renderer,
      mainSession: MAIN,
      write: () => undefined,
      onExit: () => undefined,
      palette: createPalette(THEMES.colorblind),
    });

    keepTwo(renderer);
    renderer.failures.keep({ title: 'Run the tests', content: 'FAIL a\n  got 2' });

    // The first change adds a line and removes one: blue for added, yellow for removed.
    expect(session.describeChanges('1')).toContain('\u001b[94m+1');
    expect(session.describeChanges('1')).toContain('\u001b[33m−1');
    expect(session.describeFailures()).toContain('\u001b[33mFAIL a');
  });

  it('describes the latest change, or says there is none', () => {
    const { session, renderer } = chat();

    expect(session.describeLatest()).toBe('No file changes in this chat yet.');

    keepTwo(renderer);
    expect(session.describeLatest()).toContain('c.ts');
    expect(session.describeLatest()).not.toContain('a.ts');
  });
});

describe('ChatSession: running tools', () => {
  const callId = callIdSchema.parse('1');
  const call = { id: callId, name: 'run_command', input: {} };
  const entry = (event: EntryEvent): StreamEntry => ({
    seq: event.seq,
    at: 0,
    sessionId: MAIN,
    kind: 'event',
    event,
  });
  const started = entry({ seq: 0, type: 'tool_call_started', call, description: 'Build' });
  const returned = entry({
    seq: 1,
    type: 'tool_result',
    call,
    description: 'Build',
    message: { role: 'tool', toolCallId: callId, content: 'ok', isError: false },
    durationMs: 1,
  });

  /** A chat whose prompt streams `entries`, then fails when `failAfter` says so. */
  function toolChat(params: { entries: StreamEntry[]; failAfter: boolean }) {
    const told: string[][] = [];
    const conversation: ChatConversation = {
      runningTasks: 0,
      skills: () => Promise.resolve([]),
      details: () => Promise.reject(new Error('not needed')),
      useModel: () => Promise.resolve(false),
      send: () => stream(params),
    };
    const session = new ChatSession({
      conversation,
      renderer: new Renderer(
        () => undefined,
        () => 0,
      ),
      mainSession: MAIN,
      write: () => undefined,
      onTools: (tools) => told.push(tools.map(({ description }) => description)),
      onExit: () => undefined,
    });

    return { session, told };
  }

  async function* stream(params: { entries: StreamEntry[]; failAfter: boolean }) {
    await Promise.resolve();
    yield* params.entries;
    if (params.failAfter) throw new Error('the backend went away');
  }

  it('tells the UI when a call starts and when it returns, and nothing in between', async () => {
    const { session, told } = toolChat({
      entries: [started, entry({ seq: 2, type: 'text_delta', text: 'hi' }), returned],
      failAfter: false,
    });

    session.submit('go');
    await session.idle();

    expect(told).toEqual([['Build'], []]);
  });

  it('clears the running tools when the prompt fails before the call returned', async () => {
    const { session, told } = toolChat({ entries: [started], failAfter: true });

    session.submit('go');
    await session.idle();

    expect(told).toEqual([['Build'], []]);
  });
});

describe('ChatSession: failures', () => {
  const failTwoLines = (renderer: Renderer) =>
    renderer.failures.keep({ title: 'Run the tests', content: 'FAIL a.test.ts\n  got 2' });

  it('answers /errors without sending it: the list, then one failure in full', async () => {
    const { session, renderer, fake, output } = chat();

    failTwoLines(renderer);
    session.submit('/errors');
    session.submit('/errors #1');
    await session.idle();

    expect(fake.sent).toEqual([]);
    expect(output()).toContain('Failed steps in this chat');
    expect(output()).toContain('  got 2');
  });

  it('says so when no failure was kept', async () => {
    const { session, output } = chat();

    session.submit('/errors');
    await session.idle();

    expect(output()).toContain('No failed steps with more to say');
  });

  it('expands whichever collapsed line came last', () => {
    const { session, renderer } = chat();
    const callId = callIdSchema.parse('1');
    const step = { seq: 0, call: { id: callId, name: 'tool', input: {} }, durationMs: 1 };
    const failed: EntryEvent = {
      ...step,
      type: 'tool_result',
      description: 'failing step',
      message: { role: 'tool', toolCallId: callId, content: 'one\ntwo', isError: true },
    };
    const created: EntryEvent = {
      ...step,
      type: 'tool_result',
      description: 'creating step',
      message: { role: 'tool', toolCallId: callId, content: 'Created c.ts', isError: false },
      artifacts: [{ kind: 'file_change', path: 'c.ts', before: null, after: 'x\n' }],
    };

    renderer.event(failed);
    expect(session.describeLatest()).toContain('two');

    renderer.event(created);
    expect(session.describeLatest()).toContain('c.ts');
    expect(session.describeLatest()).not.toContain('two');
  });
});

describe('ChatSession', () => {
  it('sends a line and prints its answer', async () => {
    const { session, fake, output } = chat();

    session.submit('hello');
    await tick();
    fake.open[0]?.release();
    await session.idle();

    expect(fake.sent).toEqual(['hello']);
    expect(output()).toContain('answer to hello');
    expect(session.busy).toBe(false);
  });

  it('queues a line typed while one runs, tells the UI, and sends it after, in order', async () => {
    const { session, fake, queues } = chat();

    session.submit('first');
    await tick();
    session.submit('second');
    session.submit('third');

    expect(session.busy).toBe(true);
    expect(session.queued).toEqual(['second', 'third']);
    expect(fake.sent).toEqual(['first']);

    fake.open[0]?.release();
    await tick();
    expect(fake.sent).toEqual(['first', 'second']);
    expect(session.queued).toEqual(['third']);

    fake.open[1]?.release();
    await tick();
    fake.open[2]?.release();
    await session.idle();

    expect(fake.sent).toEqual(['first', 'second', 'third']);
    expect(queues.at(-1)).toEqual([]);
  });

  it('stops the running prompt, keeps the lines waiting, and runs them next', async () => {
    const { session, fake } = chat();

    session.submit('long job');
    await tick();
    session.submit('after');

    expect(session.stop()).toBe('stopped');
    expect(session.stop()).toBe('stopping');
    await tick();
    expect(fake.sent).toEqual(['long job', 'after']);
    expect(fake.open[0]?.signal?.aborted).toBe(true);

    fake.open[1]?.release();
    await session.idle();
    expect(session.stop()).toBe('idle');
  });

  it('shows a failure and goes on to the next line', async () => {
    const { session, fake, output } = chat({ failOn: 'bad' });

    session.submit('bad');
    session.submit('good');
    await tick();
    fake.open[0]?.release();
    await session.idle();

    expect(output()).toContain('✗ the backend went away');
    expect(fake.sent).toEqual(['bad', 'good']);
    expect(output()).toContain('answer to good');
    expect(session.busy).toBe(false);
  });

  it('prints help, lists the models and switches by name or id', async () => {
    const { session, fake, output } = chat();

    session.submit('/help');
    session.submit('/model');
    session.submit('/model Deep');
    await session.idle();

    expect(output()).toContain('Type a message and press Enter');
    expect(output()).toContain('● Fast');
    expect(output()).toContain('→ Deep: openai / gpt-deep');
    expect(fake.model()).toBe(DEEP);

    session.submit(`/model ${FAST}`);
    await session.idle();
    expect(fake.model()).toBe(FAST);
  });

  it('refuses a model it has not got, without switching', async () => {
    const { session, fake, output } = chat();

    session.submit('/model Nope');
    await session.idle();

    expect(output()).toContain('Unknown model Nope');
    expect(fake.model()).toBe(FAST);
  });

  it('sets effort independently and restores each model’s last effort when switching back', async () => {
    const { session, fake, output } = chat();

    for (const line of [
      '/mode high',
      '/model Deep',
      '/mode low',
      '/model Fast',
      '/mode',
      '/mode turbo',
    ]) {
      session.submit(line);
    }

    await session.idle();
    expect((await fake.conversation.details()).model.mode).toBe('high');
    expect(output()).toContain('→ Fast · high');
    expect(output()).toContain('→ Deep · low');
    expect(output()).toContain('Fast · high');
    expect(output()).toContain('Choose a mode: low, medium, high, extreme.');
    expect(fake.sent).toEqual([]);
  });

  it('reports a command no skill has, instead of sending it', async () => {
    const { session, fake, output } = chat({ skills: ['review'] });

    session.submit('/nope do this');
    await session.idle();

    expect(output()).toContain('Unknown command /nope');
    expect(fake.sent).toEqual([]);
  });

  it('sends a message that mentions a skill that exists', async () => {
    const { session, fake } = chat({ skills: ['review'] });

    session.submit('please /review this');
    await tick();
    fake.open[0]?.release();
    await session.idle();

    expect(fake.sent).toEqual(['please /review this']);
  });

  it('leaves on /exit: tells the UI once, and drops what waited and what comes after', async () => {
    const { session, fake, exited } = chat();

    session.submit('/exit');
    session.submit('never sent');
    await session.idle();
    session.submit('also never sent');
    await session.idle();

    expect(exited()).toBe(1);
    expect(fake.sent).toEqual([]);
    expect(session.queued).toEqual([]);
  });

  it('says when it starts and stops running lines, once for a run of queued ones', async () => {
    const busy: boolean[] = [];
    const fake = fakeConversation({ skills: [], failOn: undefined });
    const session = new ChatSession({
      conversation: fake.conversation,
      renderer: new Renderer(
        () => undefined,
        () => 0,
      ),
      mainSession: MAIN,
      write: () => undefined,
      onBusy: (isBusy) => busy.push(isBusy),
      onExit: () => undefined,
    });

    session.submit('one');
    await tick();
    session.submit('two');
    fake.open[0]?.release();
    await tick();
    fake.open[1]?.release();
    await session.idle();

    expect(busy).toEqual([true, false]);
  });

  it('ignores an empty line', async () => {
    const { session, fake, output } = chat();

    session.submit('   ');
    await session.idle();

    expect(fake.sent).toEqual([]);
    expect(output()).toBe('');
  });
});
