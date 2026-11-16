import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { WorkbookOptionError } from '../../errors/workbook.errors.js';
import { RunRecorder } from '../recorder.service.js';
import { WorkbookStore } from '../store.service.js';
import type { RunResult } from '../workbook.types.js';
import { runIdSchema } from '../workbook.validator.js';
import {
  diffResults,
  mergeTextDeltas,
  parseCommand,
  runId,
  workbookMode,
  workbookModel,
} from '../workbook.utils.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const callId = callIdSchema.parse('c');

/** A workbook folder per test: one stored prompt, and a fixture workspace for it. */
const temp = useTempWorkspace({
  prefix: 'workbook-test-',
  perTest: true,
  files: {
    'workspaces/basic/notes.md': 'fixture\n',
    'prompts/demo.md':
      '---\ndescription: a demo\nworkspace: basic\nmaxTurns: 5\n---\nRead notes.md.\n',
  },
});

async function tempWorkbook(): Promise<WorkbookStore> {
  return new WorkbookStore(temp.root);
}

/** A temp workbook with one run of the `demo` prompt claimed: its store and the run's files. */
async function demoRun() {
  const store = await tempWorkbook();
  const paths = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

  return { store, paths };
}

describe('runId', () => {
  it('numbers runs and names them after the prompt, so they sort in order', () => {
    expect(runId({ number: 7, prompt: 'write-and-edit' })).toBe('0007-write-and-edit');
    expect(runId({ number: 12, prompt: 'Ask: what?!' })).toBe('0012-ask-what');
    expect(runId({ number: 1, prompt: '???' })).toBe('0001-run');
  });
});

describe('workbookModel', () => {
  it('uses --model, else WORKBOOK_MODEL, else none', () => {
    expect(workbookModel({ flag: 'opus', env: { WORKBOOK_MODEL: 'deepseek' } })).toBe('opus');
    expect(workbookModel({ flag: undefined, env: { WORKBOOK_MODEL: 'deepseek' } })).toBe(
      'deepseek',
    );
    expect(workbookModel({ flag: undefined, env: {} })).toBeUndefined();
  });

  it('treats an empty value as none, so a default can be cleared for one run', () => {
    expect(workbookModel({ flag: '', env: { WORKBOOK_MODEL: '' } })).toBeUndefined();
    expect(workbookModel({ flag: '  ', env: { WORKBOOK_MODEL: 'deepseek' } })).toBe('deepseek');
  });
});

describe('workbookMode', () => {
  it('uses --mode, else WORKBOOK_MODE, else none', () => {
    expect(workbookMode({ flag: 'high', env: { WORKBOOK_MODE: 'low' } })).toBe('high');
    expect(workbookMode({ flag: undefined, env: { WORKBOOK_MODE: 'low' } })).toBe('low');
    expect(workbookMode({ flag: undefined, env: {} })).toBeUndefined();
    expect(workbookMode({ flag: '', env: { WORKBOOK_MODE: '' } })).toBeUndefined();
  });

  it('refuses a value that is not a mode, rather than running on another effort', () => {
    expect(() => workbookMode({ flag: 'max', env: {} })).toThrow(WorkbookOptionError);
    expect(() => workbookMode({ flag: 'max', env: {} })).toThrow(
      expect.objectContaining({ value: 'max' }) as Error,
    );
    expect(() => workbookMode({ flag: 'max', env: {} })).toThrow('not one of');
    expect(() => workbookMode({ flag: undefined, env: { WORKBOOK_MODE: 'fast' } })).toThrow(
      'WORKBOOK_MODE',
    );
  });

  it('is read by every command that runs, and never mistaken for a word', () => {
    expect(parseCommand(['run', 'guards', '--mode', 'high'])).toMatchObject({
      name: 'run',
      prompt: 'guards',
      mode: 'high',
    });
    expect(parseCommand(['check', 'guards', '--mode', 'low'])).toMatchObject({
      name: 'check',
      prompts: ['guards'],
      mode: 'low',
    });
    expect(parseCommand(['run', 'guards', '--mode'])).toEqual({ name: 'help' });
    expect(parseCommand(['run', 'guards', '--mode=high'])).toEqual({ name: 'help' });
  });
});

describe('parseCommand', () => {
  it('parses each command and its flags', () => {
    expect(parseCommand(['run', 'guards', '--continue', 'last', '--model-calls'])).toEqual({
      name: 'run',
      prompt: 'guards',
      continueRun: 'last',
      fresh: true,
      showModelCalls: true,
      trust: false,
    });
    expect(parseCommand(['run', 'guards', '--keep'])).toMatchObject({ fresh: false });
    expect(parseCommand(['run', 'guards', '--keep', '--trust'])).toMatchObject({ trust: true });
    expect(parseCommand(['continue', '--trust', 'and then'])).toMatchObject({
      text: 'and then',
      trust: true,
    });
    expect(parseCommand(['ask', 'hello', 'there'])).toMatchObject({
      name: 'ask',
      text: 'hello there',
    });
    expect(parseCommand(['continue', 'and then'])).toMatchObject({
      name: 'continue',
      text: 'and then',
    });
    expect(parseCommand(['continue', '3', 'and then'])).toMatchObject({
      run: '3',
      text: 'and then',
    });
    expect(parseCommand(['step', '2', '--from', '30'])).toEqual({
      name: 'step',
      run: '2',
      from: 30,
    });
    expect(parseCommand(['diff', '1', '2'])).toEqual({ name: 'diff', a: '1', b: '2' });
  });

  it('reads --model for every command that runs, and never mistakes its value for a word', () => {
    expect(parseCommand(['run', 'guards', '--model', 'deepseek'])).toMatchObject({
      prompt: 'guards',
      model: 'deepseek',
    });
    expect(parseCommand(['--model', 'deepseek', 'ask', 'hello', 'there'])).toMatchObject({
      text: 'hello there',
      model: 'deepseek',
    });
    expect(parseCommand(['check', 'working-root', '--model', 'deepseek'])).toMatchObject({
      prompts: ['working-root'],
      model: 'deepseek',
    });
    expect(parseCommand(['continue', '3', 'and then', '--model', 'opus'])).toMatchObject({
      run: '3',
      text: 'and then',
      model: 'opus',
    });
    expect(parseCommand(['run', 'guards'])).toMatchObject({ model: undefined });
  });

  it('drops a flag value by position, so a value equal to a prompt name keeps the prompt', () => {
    expect(parseCommand(['run', 'guards', '--model', 'guards'])).toMatchObject({
      name: 'run',
      prompt: 'guards',
      model: 'guards',
    });
    expect(parseCommand(['continue', '3', 'and then', '--model', '3'])).toMatchObject({
      run: '3',
      text: 'and then',
      model: '3',
    });
  });

  it('shows help for a --model with no value of its own, instead of ignoring it', () => {
    for (const argv of [
      ['run', 'guards', '--model'],
      ['run', 'guards', '--model', '--keep'],
      ['ask', 'hello', '--model='],
      ['run', 'guards', '--model=deepseek'],
    ]) {
      expect(parseCommand(argv)).toEqual({ name: 'help' });
    }
  });

  it('shows help for anything incomplete or unknown', () => {
    for (const argv of [[], ['run'], ['ask'], ['continue'], ['diff', '1'], ['nope']]) {
      expect(parseCommand(argv)).toEqual({ name: 'help' });
    }
  });
});

describe('mergeTextDeltas', () => {
  it('merges consecutive text deltas into one step, keeping the first seq', () => {
    const events: AgentEvent[] = [
      { seq: 0, type: 'text_delta', text: 'Hel' },
      { seq: 1, type: 'text_delta', text: 'lo' },
      { seq: 2, type: 'turn_end', turn: 1, stopReason: 'end_turn' },
    ];

    expect(mergeTextDeltas(events)).toEqual([
      { seq: 0, type: 'text_delta', text: 'Hello' },
      { seq: 2, type: 'turn_end', turn: 1, stopReason: 'end_turn' },
    ]);
  });
});

describe('diffResults', () => {
  const result = (overrides: Partial<RunResult> = {}): RunResult => ({
    outcome: 'completed',
    endedAt: 0,
    durationMs: 1000,
    events: 10,
    modelCalls: 2,
    toolCalls: 1,
    toolErrors: 0,
    sessions: 1,
    messages: 4,
    ...overrides,
  });

  it('lists only what differs, plus the duration and whether the answer changed', () => {
    const lines = diffResults({
      a: { id: runIdSchema.parse('a'), result: result(), tools: ['read_file'], answer: 'same' },
      b: {
        id: runIdSchema.parse('b'),
        result: result({ outcome: 'failed', toolErrors: 1 }),
        tools: ['read_file'],
        answer: 'same',
      },
    });

    expect(lines).toEqual([
      'outcome: completed → failed',
      'toolErrors: 0 → 1',
      'duration: 1.0s → 1.0s',
      'answer: the same',
    ]);
  });
});

describe('WorkbookStore', () => {
  it('numbers runs across calls and remembers the last finished one, overall and per prompt', async () => {
    const store = await tempWorkbook();
    const first = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });
    const second = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'ask' }) });

    expect([first.id, second.id]).toEqual(['0001-demo', '0002-ask']);
    // Begun is not finished: neither is `last` yet.
    expect((await store.state()).lastRun).toBeUndefined();

    await store.finishRun({ id: first.id, prompt: 'demo' });
    await store.finishRun({ id: second.id, prompt: 'ask' });
    expect(await store.state()).toEqual({
      version: 1,
      runCount: 2,
      lastRun: '0002-ask',
      lastRunByPrompt: { demo: '0001-demo', ask: '0002-ask' },
    });
    // The workbook picks up where it left off: a new store on the same folder continues the count.
    const again = await new WorkbookStore(store.root).beginRun({ id: (n) => `${n}` });

    expect(again.id).toBe('3');
  });

  it('hands out distinct run numbers to runs begun at the same time', async () => {
    const store = await tempWorkbook();
    const begun = await Promise.all(
      Array.from({ length: 8 }, () =>
        new WorkbookStore(store.root).beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) }),
      ),
    );

    expect(new Set(begun.map(({ id }) => id)).size).toBe(8);
    expect((await store.state()).runCount).toBe(8);
  });

  it('names state.json and says how to start over when it is not JSON or not a state', async () => {
    const store = await tempWorkbook();
    const claim = () => store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

    for (const contents of ['not json{', '{"version":99}']) {
      await writeFile(path.join(store.root, 'state.json'), contents);
      await expect(claim()).rejects.toThrow(/state\.json.*delete it to start over/s);
      await expect(store.finishRun({ id: runIdSchema.parse('1-a'), prompt: 'a' })).rejects.toThrow(
        /delete it to start over/,
      );
    }
  });

  it('does not let a run that was cut short become "last"', async () => {
    const store = await tempWorkbook();
    const done = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

    await store.finishRun({ id: done.id, prompt: 'demo' });
    // A second run is claimed and then force-quit: its folder exists, but it never finished.
    const cut = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

    expect(await store.resolveRun('last')).toBe(done.id);
    expect(await store.metaIfThere(cut.id)).toBeUndefined();
    expect(await store.result(cut.id)).toBeUndefined();
    expect(await store.events(cut.id)).toEqual([]);
  });

  it('resolves runs by full id, number, prefix or "last", and explains a miss', async () => {
    const store = await tempWorkbook();

    await expect(store.resolveRun(undefined)).rejects.toThrow('No runs yet');
    await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

    const second = await store.beginRun({ id: (n) => runId({ number: n, prompt: 'demo' }) });

    await store.finishRun({ id: second.id, prompt: 'demo' });

    expect(await store.resolveRun('last')).toBe('0002-demo');
    expect(await store.resolveRun('1')).toBe('0001-demo');
    expect(await store.resolveRun('0002')).toBe('0002-demo');
    expect(await store.resolveRun('0001-demo')).toBe('0001-demo');
    await expect(store.resolveRun('9')).rejects.toThrow('No run "9"');
  });

  it('reads stored prompts, and gives each run a fresh copy of its fixture, plus a fake .env', async () => {
    const store = await tempWorkbook();
    const prompt = await store.prompt('demo');

    expect(prompt).toMatchObject({
      name: 'demo',
      text: 'Read notes.md.',
      workspace: 'basic',
      maxTurns: 5,
    });
    await expect(store.prompt('missing')).rejects.toThrow('No stored prompt "missing"');

    const first = await store.workspace({ prompt, key: 'demo', keep: true });

    // A first --keep run has nothing to keep: it copies the fixture fresh, safe to trust.
    expect(first.fresh).toBe(true);
    await writeFile(path.join(first.dir, 'notes.md'), 'changed by a run\n');
    expect(await readFile(path.join(first.dir, '.env'), 'utf8')).toContain('SECRET=');

    // --keep reuses the last workspace (work builds up, so not fresh); otherwise it starts fresh.
    const kept = await store.workspace({ prompt, key: 'demo', keep: true });

    expect(kept.fresh).toBe(false);
    expect(await readFile(path.join(kept.dir, 'notes.md'), 'utf8')).toBe('changed by a run\n');

    const fresh = await store.workspace({ prompt, key: 'demo', keep: false });

    expect(fresh.fresh).toBe(true);
    expect(await readFile(path.join(fresh.dir, 'notes.md'), 'utf8')).toBe('fixture\n');
    // The fixture itself is never touched.
    expect(await readFile(path.join(store.workspacesDir, 'basic', 'notes.md'), 'utf8')).toBe(
      'fixture\n',
    );
  });

  it('refuses names that are paths, so nothing outside its folder is read or removed', async () => {
    const store = await tempWorkbook();
    const outside = path.join(temp.root, 'keep-me');

    await writeFile(outside, 'not the workbook’s\n');

    await expect(store.prompt('../keep-me')).rejects.toThrow("isn't a prompt name");
    await expect(store.workspace({ prompt: undefined, key: '../..', keep: false })).rejects.toThrow(
      "isn't a prompt name",
    );
    expect(await readFile(outside, 'utf8')).toBe('not the workbook’s\n');

    await writeFile(path.join(store.promptsDir, 'escape.md'), '---\nworkspace: ../..\n---\nHi\n');
    await expect(store.prompt('escape')).rejects.toThrow('not a path');
  });

  it('checks what it reads back: the last run must exist, and saved events must be events', async () => {
    const store = await tempWorkbook();
    const paths = await store.beginRun({ id: () => 'r1' });

    await writeFile(paths.events, '{"seq":0,"type":"not_an_event"}\n');
    await expect(store.events(runIdSchema.parse('r1'))).rejects.toThrow('Could not read');

    await writeFile(
      path.join(store.root, 'state.json'),
      JSON.stringify({ version: 1, runCount: 1, lastRun: 'gone', lastRunByPrompt: {} }),
    );
    await expect(store.resolveRun('last')).rejects.toThrow("isn't in runs/");
  });
});

describe('RunRecorder', () => {
  it('writes every artifact, and a result with counts, even for a failed run', async () => {
    const { store, paths } = await demoRun();
    const recorder = new RunRecorder(paths);
    const main = sessionIdSchema.parse('main');
    const frame = 'event: entry\nid: 0\ndata: {"seq":0}\n\n';
    const stop = new AbortController();
    // The backend's stream as a UI reads it: a frame, then open until the recorder stops it.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        stop.signal.addEventListener('abort', () => controller.error(stop.signal.reason));
      },
    });

    recorder.recordSessions(stream, stop);
    await recorder.start({
      id: paths.id,
      prompt: 'demo',
      text: 'Read notes.md.',
      startedAt: DateTime.utc(2026, 1, 1).toMillis(),
      adapter: 'test',
      model: 'test',
      workspace: '/tmp/x',
      mainSession: main,
    });
    // The backend appends each model call to the run's file itself.
    await writeFile(paths.modelCalls, '{"messages":[{"role":"user","content":"hi"}]}\n');
    recorder.event({ seq: 0, type: 'text_delta', text: 'Hi' });
    recorder.event({
      seq: 1,
      type: 'tool_result',
      call: { id: callId, name: 'read_file', input: {} },
      description: 'reading',
      durationMs: 1,
      message: { role: 'tool', toolCallId: callId, content: 'nope', isError: true },
    });
    recorder.transcript('Hi\n');

    const result = await recorder.finish({
      outcome: 'failed',
      error: 'boom',
      messages: [{ role: 'user', content: 'hi' }],
      sessions: 1,
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      error: 'boom',
      events: 2,
      modelCalls: 1,
      toolCalls: 1,
      toolErrors: 1,
      lastEvent: '#1 tool_result',
    });
    expect(await store.events(paths.id)).toHaveLength(2);
    expect(await store.result(paths.id)).toEqual(result);
    expect(await store.meta(paths.id)).toMatchObject({ prompt: 'demo', mainSession: main });
    expect(await store.messages(paths.id)).toEqual([{ role: 'user', content: 'hi' }]);
    expect(await readFile(paths.transcript, 'utf8')).toBe('Hi\n');
    expect(await readFile(paths.sessions, 'utf8')).toBe(frame);
  });

  it('a run without a result reads as unfinished, and refuses to be continued', async () => {
    const { store, paths } = await demoRun();

    expect(await store.result(paths.id)).toBeUndefined();
    await expect(store.messages(paths.id)).rejects.toThrow("didn't finish");
    expect(await store.answer(paths.id)).toBe('');
  });

  it('reads a done saved with its messages, as runs before the stream saved it, and without', async () => {
    const { store, paths } = await demoRun();
    const session = { id: 'main', depth: 1, rootId: 'main' };
    const done = { seq: 1, type: 'done', reason: 'completed', session };
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'The answer.', toolCalls: [] },
    ];

    await writeFile(
      paths.events,
      `${JSON.stringify({ ...done, messages })}\n${JSON.stringify({ ...done, seq: 2 })}\n`,
    );
    await writeFile(paths.messages, JSON.stringify(messages));

    expect((await store.events(paths.id)).map((event) => event.type)).toEqual(['done', 'done']);
    expect(await store.answer(paths.id)).toBe('The answer.');
  });
});
