import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { fakeTerminal } from '../../testing/terminal.fake.js';
import { ChatScreen } from '../../tui/chat-screen.service.js';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { ReactView } from '../react-view.service.js';

function open(rows = 24, interactive = false, columns = 80) {
  const terminal = fakeTerminal(columns, rows);
  const stdout = Object.assign(new PassThrough(), { isTTY: interactive, columns, rows });
  const view = new ReactView({
    terminal,
    stdout,
    status: { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 },
    commands: ChatScreen.commands,
    cwd: process.cwd(),
  });

  return { view, terminal, stdout };
}

describe('ReactView', () => {
  it('keeps committed history unchanged while only the live tail changes', () => {
    const { view } = open();

    view.print('one');

    const line = view.snapshot.history[0];

    view.setLive('two');
    view.setLive('two three');

    expect(view.snapshot.history).toEqual([{ id: 0, text: 'one' }]);
    expect(view.snapshot.history[0]).toBe(line);
    expect(view.snapshot.live).toBe('two three');
  });

  it('publishes a new history array on append without mutating a previous frame', () => {
    const { view } = open();
    const previous = view.snapshot.history;

    view.print('next');

    expect(previous).toEqual([]);
    expect(view.snapshot.history).toEqual([{ id: 0, text: 'next' }]);
  });

  it('writes appended static lines exactly once through a mounted Ink renderer', async () => {
    const { view, stdout } = open(24, true);
    const chunks: string[] = [];

    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => chunks.push(chunk));
    view.start();

    try {
      for (const line of ['FIRST_COMMIT', 'SECOND_COMMIT', 'THIRD_COMMIT']) {
        view.print(line);
        view.requestRender();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      view.setLive('live tail');
      view.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 60));

      const output = chunks.join('');

      for (const line of ['FIRST_COMMIT', 'SECOND_COMMIT', 'THIRD_COMMIT']) {
        expect(output.split(line).length - 1).toBe(1);
      }

      expect(output).not.toContain('\u001b[3J');
      expect(output).not.toContain('\u001b[?1049h');
    } finally {
      view.stop();
    }
  });

  it.each([
    { text: 'hello', columns: 80, caret: 5 },
    { text: '界🙂', columns: 80, caret: 4 },
    { text: 'hello', columns: 4, caret: 2 },
  ])(
    'commits the caret with the typed text at $columns columns',
    async ({ text, columns, caret }) => {
      const { view, terminal, stdout } = open(24, true, columns);
      let output = '';

      stdout.setEncoding('utf8');
      stdout.on('data', (chunk: string) => (output += chunk));
      view.start();

      async function typeAndCheckCaret(data: string): Promise<void> {
        terminal.type(data);
        await new Promise((resolve) => setTimeout(resolve, 60));

        const columnMove = output.split('\u001b[?25h').at(-2)?.split('\u001b[').at(-1);

        expect(columnMove).toMatch(/^\d+G$/);
        expect(Number(columnMove?.slice(0, -1)) - 1).toBe(view.snapshot.editor.cursor?.x);
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 60));

        for (const character of text) {
          await typeAndCheckCaret(character);
        }

        expect(view.snapshot.editor.cursor?.x).toBe(caret);
        await typeAndCheckCaret('\u001b[D');
        await typeAndCheckCaret('\u007f');
      } finally {
        view.stop();
      }
    },
  );

  it('removes ANSI styling when NO_COLOR is set, including an empty value', () => {
    vi.stubEnv('NO_COLOR', '');

    try {
      const { view } = open();

      view.print('\u001b[31merror\u001b[0m');
      view.setLive('\u001b[32mlive\u001b[0m');
      expect(view.snapshot.history[0]?.text).toBe('error');
      expect(view.snapshot.live).toBe('live');
      expect(view.snapshot.editor.lines.join('')).not.toContain('\u001b');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not approve a clipped preview, but still allows Escape to skip', () => {
    const { view, terminal } = open(8);
    const onAnswer = vi.fn();
    const screen = new ChatScreen({
      view,
      status: { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 },
      commands: ChatScreen.commands,
      cwd: process.cwd(),
      onSubmit: vi.fn(),
      onStop: () => 'idle',
      onAnswer,
      onQuit: vi.fn(),
    });

    screen.start();

    try {
      screen.ask({
        id: approvalIdSchema.parse('a1'),
        callId: callIdSchema.parse('c1'),
        tool: 'run_command',
        command: 'npm test',
        concerns: Array.from({ length: 20 }, () => ({ argument: 'test', reason: 'not allowed' })),
        options: ['approve', 'skip'],
      });
      terminal.type('1');
      terminal.type('\r');
      expect(onAnswer).not.toHaveBeenCalled();
      terminal.type('\u001b');
      expect(onAnswer).toHaveBeenCalledWith({ id: 'a1', response: { decision: 'skip' } });
    } finally {
      screen.stop();
    }
  });
});
