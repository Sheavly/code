import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import type { ModelMode } from '@sheavly/protocol/model/model.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { ModelChoice } from '@sheavly/protocol/server/server.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { Renderer } from '../../render/render.service.js';
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
  const session = new ChatSession({
    conversation: fake.conversation,
    renderer: new Renderer(
      (out) => written.push(out),
      () => 0,
    ),
    mainSession: MAIN,
    write: (out) => written.push(out),
    onQueue: (queue) => queues.push([...queue]),
    onExit: () => (exited += 1),
  });

  return { session, fake, written, queues, exited: () => exited, output: () => written.join('') };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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
