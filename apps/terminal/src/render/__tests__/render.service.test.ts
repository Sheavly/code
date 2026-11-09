import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
import { createChatLook } from '../chat-look.utils.js';
import { Renderer } from '../render.service.js';
import type { EntryEvent, ToolArtifact } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';

const callId = callIdSchema.parse('1');
const main = sessionIdSchema.parse('main');
const chatLook = createChatLook();

/** What the renderer prints for one successful `tool_result` with `artifacts`. */
function rendered(params: { content: string; artifacts?: ToolArtifact[] }): string {
  const { content, artifacts } = params;
  let out = '';
  const event: EntryEvent = {
    seq: 0,
    type: 'tool_result',
    call: { id: callId, name: 'tool', input: {} },
    description: 'doing it',
    message: { role: 'tool', toolCallId: callId, content, isError: false },
    durationMs: 1200,
    ...(artifacts && { artifacts }),
  };

  new Renderer(
    (text) => (out += text),
    () => 0,
  ).event(event);

  return out;
}

describe('Renderer: entries', () => {
  it('escapes controls before reply and tool-start rendering, without changing source events', () => {
    let output = '';
    const renderer = new Renderer(
      (text) => (output += text),
      () => 0,
      chatLook,
    );
    const command = 'printf hi\u001b]52;c;tool\u0007';
    const call = { id: callId, name: 'run_command', input: { command } };
    const text = 'reply\u001b]';

    renderer.event({ seq: 0, type: 'text_delta', text });
    renderer.event({ seq: 1, type: 'text_delta', text: '52;c;reply\u0007' });
    renderer.event({ seq: 2, type: 'tool_call_started', call, description: 'step\u001b[2J' });
    expect(output).not.toContain('\u001b]52;');
    expect(output).not.toContain('\u001b[2J');
    expect(output).toContain('\\u001b]52;c;reply\\u0007');
    expect(output).toContain('step\\u001b[2J');
    expect(call.input.command).toBe(command);
    expect(text).toBe('reply\u001b]');
  });

  const text = (sessionId: string, seq: number): StreamEntry => ({
    seq,
    at: 0,
    sessionId: sessionIdSchema.parse(sessionId),
    kind: 'event',
    event: { seq, type: 'text_delta', text: `from ${sessionId}` },
  });

  it('prints the main session’s events, not a sub-agent’s', () => {
    let out = '';
    const renderer = new Renderer(
      (written) => (out += written),
      () => 0,
    );

    renderer.entry(text('main', 0), main);
    renderer.entry(text('child', 1), main);
    expect(out).toBe('from main');
  });

  it('says how many background tasks a finished turn still waits for', () => {
    let out = '';
    const renderer = new Renderer(
      (written) => (out += written),
      () => 2,
    );

    renderer.event({ seq: 0, type: 'turn_end', turn: 1, stopReason: 'end_turn' });
    expect(out).toContain('waiting for 2 background task(s)');
  });
});

describe('Renderer: chat look', () => {
  /** What a person sees for these events, without colour. */
  function chatted(events: EntryEvent[]): string {
    let out = '';
    const renderer = new Renderer(
      (text) => (out += text),
      () => 0,
      chatLook,
    );

    for (const event of events) renderer.event(event);

    return stripVTControlCharacters(out);
  }

  const started: EntryEvent = {
    seq: 0,
    type: 'tool_call_started',
    call: { id: callId, name: 'run_command', input: { command: 'npm test' } },
    description: 'Run the tests',
  };
  const result: EntryEvent = {
    seq: 1,
    type: 'tool_result',
    call: { id: callId, name: 'run_command', input: {} },
    description: 'Run the tests',
    message: { role: 'tool', toolCallId: callId, content: 'ok', isError: false },
    durationMs: 300,
  };
  const reply = (text: string): EntryEvent => ({ seq: 2, type: 'text_delta', text });
  const finished = (reason: Extract<EntryEvent, { type: 'done' }>['reason']): EntryEvent => ({
    seq: 4,
    type: 'done',
    reason,
    session: { id: main, rootId: main, depth: 1 },
  });

  it('sets the reply apart from the steps around it with a blank line', () => {
    expect(chatted([reply('Let me check.'), started, result, reply('All passing.')])).toBe(
      'Let me check.\n\n⏺ Run the tests  $ npm test\n  ⎿ ✓ 2 chars · 0.3s\n\nAll passing.',
    );
  });

  it('leaves out the loop’s bookkeeping, and says so when a run was cut short', () => {
    const turnEnd: EntryEvent = { seq: 3, type: 'turn_end', turn: 1, stopReason: 'end_turn' };

    expect(chatted([reply('Hi'), turnEnd, finished('completed')])).toBe('Hi');
    expect(chatted([finished('max_turns')])).toBe('⚠ stopped at the turn limit\n');
  });

  it('shows continuation as activity, not a failed reply, and warns only when recovery stops', () => {
    const turnEnd: EntryEvent = { seq: 3, type: 'turn_end', turn: 1, stopReason: 'max_tokens' };
    const continuation: EntryEvent = {
      seq: 4,
      type: 'output_continuation',
      attempt: 1,
      maxAttempts: 2,
    };

    expect(chatted([turnEnd, continuation, reply('Finished.'), finished('completed')])).toBe(
      '… continuing after the output limit (1/2)\n\nFinished.',
    );
    expect(chatted([turnEnd, finished('max_tokens')])).toBe(
      '⚠ stopped at the output-token limit; the reply is incomplete\n',
    );
    expect(chatted([finished('context_window_exceeded')])).toBe(
      '⚠ stopped at the context limit; reduce the conversation or start a new one\n',
    );
  });

  it('shows a hook that changed the messages a call sends, with how many', () => {
    const changed: EntryEvent = {
      seq: 5,
      type: 'model_input_changed',
      hook: 'trim',
      turn: 2,
      added: 1,
      removed: 3,
      edited: 2,
    };

    expect(chatted([changed])).toBe("± trim changed this call's messages (+1 −3 ~2)\n");
  });

  it('starts the next prompt without a gap after the last one’s text', () => {
    expect(chatted([reply('One'), finished('completed'), started])).toBe(
      'One⏺ Run the tests  $ npm test\n',
    );
  });

  it('hands the reply to its own sink, and says where it ends', () => {
    const calls: string[] = [];
    const renderer = new Renderer(
      (text) => calls.push(`write ${JSON.stringify(stripVTControlCharacters(text))}`),
      () => 0,
      chatLook,
      {
        write: (text) => calls.push(`reply ${JSON.stringify(text)}`),
        end: () => calls.push('end'),
      },
    );

    for (const event of [
      reply('Hi '),
      reply('there'),
      started,
      reply('Done'),
      finished('completed'),
    ]) {
      renderer.event(event);
    }

    expect(calls).toEqual([
      'reply "Hi "',
      'reply "there"',
      'write "\\n\\n"',
      'write "⏺ Run the tests  $ npm test\\n"',
      'write "\\n"',
      'reply "Done"',
      'end',
    ]);
  });
});

describe('Renderer: themes', () => {
  const step = (isError: boolean): EntryEvent => ({
    seq: 0,
    type: 'tool_result',
    call: { id: callId, name: 'tool', input: {} },
    description: 'doing it',
    message: { role: 'tool', toolCallId: callId, content: 'x', isError },
    durationMs: 300,
  });

  function written(params: { look: ReturnType<typeof createChatLook>; event: EntryEvent }) {
    let out = '';

    new Renderer(
      (text) => (out += text),
      () => 0,
      params.look,
    ).event(params.event);

    return out;
  }

  it('colours a step’s outcome by the theme: success and failure are never red and green together', () => {
    const colorblind = createChatLook(createPalette(THEMES.colorblind));

    expect(written({ look: createChatLook(), event: step(false) })).toContain('\u001b[32m✓');
    expect(written({ look: createChatLook(), event: step(true) })).toContain('\u001b[31m✗');
    expect(written({ look: colorblind, event: step(false) })).toContain('\u001b[94m✓');
    expect(written({ look: colorblind, event: step(true) })).toContain('\u001b[33m✗');
  });

  it('says the same words in every theme: colour is never the only sign', () => {
    const colorblind = createChatLook(createPalette(THEMES.colorblind));
    const plain = (look: ReturnType<typeof createChatLook>) =>
      stripVTControlCharacters(written({ look, event: step(false) }));

    expect(plain(colorblind)).toBe(plain(createChatLook()));
    expect(plain(colorblind)).toContain('✓');
  });
});

describe('Renderer: file changes', () => {
  const change = (before: string | null, after: string): ToolArtifact => ({
    kind: 'file_change',
    path: 'a.ts',
    before,
    after,
  });

  /** What a person sees for one `tool_result` with these artifacts, without colour. */
  function shown(params: { artifacts: ToolArtifact[]; isError?: boolean }): {
    out: string;
    renderer: Renderer;
  } {
    let out = '';
    const renderer = new Renderer(
      (text) => (out += text),
      () => 0,
      chatLook,
    );

    renderer.event({
      seq: 0,
      type: 'tool_result',
      call: { id: callId, name: 'edit_file', input: {} },
      description: 'Edit a.ts',
      message: {
        role: 'tool',
        toolCallId: callId,
        content: 'Edited a.ts (2 → 2 lines)',
        isError: params.isError ?? false,
      },
      durationMs: 300,
      artifacts: params.artifacts,
    });

    return { out: stripVTControlCharacters(out), renderer };
  }

  it('collapses the change to one line under its result, with its size and how to expand it', () => {
    expect(shown({ artifacts: [change('a\nb\n', 'a\nB\n')] }).out).toBe(
      ['  ⎿ ✓ Edited a.ts (2 → 2 lines) · 0.3s', '    ▸ +1 −1 · /changes 1', ''].join('\n'),
    );
  });

  it('says a created file is new', () => {
    expect(shown({ artifacts: [change(null, 'x\ny\n')] }).out).toContain(
      '▸ +2 −0 · new file · /changes 1',
    );
  });

  it('keeps every change, numbered, for the screen to show in full', () => {
    const { renderer } = shown({ artifacts: [change('a\n', 'b\n')] });

    expect(renderer.changes.edits).toEqual([
      { number: 1, path: 'a.ts', before: 'a\n', after: 'b\n', added: 1, removed: 1 },
    ]);
  });

  it('shows nothing for a change that failed or changed nothing, and keeps nothing', () => {
    const failed = shown({ artifacts: [change('a\n', 'b\n')], isError: true });
    const same = shown({ artifacts: [change('a\n', 'a\n')] });

    expect(failed.out.split('\n')).toHaveLength(2);
    expect(same.out.split('\n')).toHaveLength(2);
    expect(failed.renderer.changes.edits).toEqual([]);
    expect(same.renderer.changes.edits).toEqual([]);
  });

  it('keeps the plain log free of file changes', () => {
    expect(rendered({ content: 'Edited', artifacts: [change('a\n', 'b\n')] })).toBe(
      '    ✓ Edited · 1.2s\n',
    );
  });
});

describe('Renderer: failed steps', () => {
  const failed = (content: string, input: Record<string, unknown> = {}): EntryEvent => ({
    seq: 0,
    type: 'tool_result',
    call: { id: callId, name: 'run_command', input },
    description: 'Run the tests',
    message: { role: 'tool', toolCallId: callId, content, isError: true },
    durationMs: 300,
  });
  const edited: EntryEvent = {
    seq: 1,
    type: 'tool_result',
    call: { id: callId, name: 'edit_file', input: {} },
    description: 'Edit a.ts',
    message: { role: 'tool', toolCallId: callId, content: 'Edited a.ts', isError: false },
    durationMs: 300,
    artifacts: [{ kind: 'file_change', path: 'a.ts', before: 'a\n', after: 'b\n' }],
  };

  function chatted(events: EntryEvent[]): { out: string; renderer: Renderer } {
    let out = '';
    const renderer = new Renderer(
      (text) => (out += text),
      () => 0,
      chatLook,
    );

    for (const event of events) renderer.event(event);

    return { out: stripVTControlCharacters(out), renderer };
  }

  it('collapses the rest of a failure to one line under its result, and keeps it', () => {
    const { out, renderer } = chatted([
      failed('FAIL a.test.ts\n  expected 1\n  got 2', { command: 'npm test' }),
    ]);

    expect(out).toBe(
      ['  ⎿ ✗ FAIL a.test.ts · 0.3s', '    ▸ 2 more lines · /errors 1', ''].join('\n'),
    );
    expect(renderer.failures.failures).toMatchObject([
      { number: 1, title: 'Run the tests  $ npm test', moreLines: 2 },
    ]);
  });

  it('adds nothing for a failure that is one line the result already showed', () => {
    const { out, renderer } = chatted([failed('File not found: a.ts')]);

    expect(out).toBe('  ⎿ ✗ File not found: a.ts · 0.3s\n');
    expect(renderer.failures.failures).toEqual([]);
    expect(renderer.latestExpandable).toBeUndefined();
  });

  it('knows whether a failure or a file change was collapsed last', () => {
    const afterChange = chatted([edited, failed('one\ntwo')]).renderer;
    const afterFailure = chatted([failed('one\ntwo'), edited]).renderer;

    expect(afterChange.latestExpandable).toBe('failure');
    expect(afterFailure.latestExpandable).toBe('change');
  });

  it('keeps the plain log free of failure lines', () => {
    let out = '';

    new Renderer(
      (text) => (out += text),
      () => 0,
    ).event(failed('one\ntwo'));
    expect(out).toBe('    ✗ one · 0.3s\n');
  });
});

describe('Renderer: running tools', () => {
  const call = (id: string) => ({ id: callIdSchema.parse(id), name: 'run_command', input: {} });
  const started = (id: string, description: string): EntryEvent => ({
    seq: 0,
    type: 'tool_call_started',
    call: call(id),
    description,
  });
  const returned = (id: string): EntryEvent => ({
    seq: 1,
    type: 'tool_result',
    call: call(id),
    description: 'done',
    message: { role: 'tool', toolCallId: callIdSchema.parse(id), content: 'ok', isError: false },
    durationMs: 1,
  });
  const finished: EntryEvent = {
    seq: 2,
    type: 'done',
    reason: 'completed',
    session: { id: main, rootId: main, depth: 1 },
  };
  const renderer = () =>
    new Renderer(
      () => undefined,
      () => 0,
    );

  afterEach(() => vi.useRealTimers());

  it('lists the calls that started and have not returned, oldest first, with when they began', () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    const subject = renderer();

    subject.event(started('1', 'Build'));
    vi.setSystemTime(1_700_000_004_000);
    subject.event(started('2', 'Lint'));

    expect(subject.running).toEqual([
      { id: '1', description: 'Build', startedAt: 1_700_000_000_000 },
      { id: '2', description: 'Lint', startedAt: 1_700_000_004_000 },
    ]);

    subject.event(returned('1'));
    expect(subject.running.map(({ id }) => id)).toEqual(['2']);
  });

  it('replaces the list on every change, and keeps it while nothing changes', () => {
    const subject = renderer();
    const empty = subject.running;

    subject.event(started('1', 'Build'));

    const one = subject.running;

    subject.event({ seq: 3, type: 'text_delta', text: 'hi' });
    expect(subject.running).toBe(one);
    expect(one).not.toBe(empty);

    subject.event(returned('1'));
    expect(subject.running).toEqual([]);
    expect(empty).toEqual([]);
  });

  it('forgets a call at the end of the prompt, or when told to', () => {
    const subject = renderer();

    subject.event(started('1', 'Build'));
    subject.event(finished);
    expect(subject.running).toEqual([]);

    subject.event(started('2', 'Lint'));
    subject.clearRunning();
    expect(subject.running).toEqual([]);
  });

  it('ignores the result of a call it never saw start', () => {
    const subject = renderer();

    subject.event(started('1', 'Build'));
    subject.event(returned('9'));
    expect(subject.running.map(({ id }) => id)).toEqual(['1']);
  });
});

describe('Renderer: tool results', () => {
  it("names a file change by the tool's summary", () => {
    const change = { kind: 'file_change', path: 'a.ts', before: null, after: 'x' };

    expect(rendered({ content: 'Created a.ts (0 → 1 lines)', artifacts: [change] })).toBe(
      '    ✓ Created a.ts (0 → 1 lines) · 1.2s\n',
    );
  });

  it('describes a read by the range it covered', () => {
    const read = {
      kind: 'file_read',
      path: 'a.ts',
      startLine: 10,
      endLine: 40,
      totalLines: 900,
      whole: false,
    };

    expect(rendered({ content: 'x'.repeat(50), artifacts: [read] })).toBe(
      '    ✓ read a.ts lines 10–40 (of 900) · 1.2s\n',
    );
  });

  it('skips artifacts it does not know, and shows the size of the text', () => {
    expect(rendered({ content: 'Parsed', artifacts: [{ kind: 'table', rows: 1 }] })).toBe(
      '    ✓ 6 chars · 1.2s\n',
    );
    expect(rendered({ content: 'Parsed' })).toBe('    ✓ 6 chars · 1.2s\n');
  });
});
