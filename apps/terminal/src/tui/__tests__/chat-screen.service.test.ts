import { PassThrough } from 'node:stream';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { stripTerminalSequences, TuiMainScreen } from '@earendil-works/pi-tui';
import type { ApprovalOption, ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import { approvalIdSchema } from '@sheavly/protocol/approval/approval.validator';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { fakeTerminal } from '../../testing/terminal.fake.js';
import { createPalette } from '../../theme/palette.utils.js';
import { THEMES } from '../../theme/theme.constants.js';
import type { Palette } from '../../theme/theme.types.js';
import { ChatScreen } from '../chat-screen.service.js';
import type { ApprovalAnswer } from '../tui.types.js';
import { ReactView } from '../../react-screen/react-view.service.js';
import { ReactScreen } from '../../react-screen/react-screen.component.js';

const ALL: ApprovalOption[] = ['approve', 'always_allow', 'skip', 'skip_with_message'];
const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const UP = '\u001b[A';
const CTRL_C = '\u0003';

const request = (id: string): ApprovalRequest => ({
  id: approvalIdSchema.parse(id),
  callId: callIdSchema.parse('c1'),
  tool: 'run_command',
  command: `npm test ${id}`,
  concerns: [{ argument: 'npm test', reason: 'is not allowed yet' }],
  options: ALL,
});

function openScreen(renderer: 'classic' | 'react', palette?: Palette) {
  const terminal = fakeTerminal();
  const tui = new TuiMainScreen(terminal);
  const sent: string[] = [];
  const answers: ApprovalAnswer[] = [];
  let quit = 0;
  let stopResult: 'stopped' | 'stopping' | 'idle' = 'idle';
  let stops = 0;
  const view =
    renderer === 'react'
      ? new ReactView({
          terminal,
          stdout: new PassThrough(),
          status: { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 },
          commands: ChatScreen.commands,
          cwd: process.cwd(),
          ...(palette && { palette }),
        })
      : undefined;
  const screen = new ChatScreen({
    ...(view ? { view } : { tui, ...(palette && { palette }) }),
    status: { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 },
    commands: ChatScreen.commands,
    cwd: process.cwd(),
    onSubmit: (line) => sent.push(line),
    onStop: () => {
      stops += 1;

      return stopResult;
    },
    onAnswer: (answer) => answers.push(answer),
    onQuit: () => (quit += 1),
    onExpand: () => 'a diff\nof two lines',
  });

  screen.start();
  onTestFinished(() => screen.stop());

  return {
    screen,
    terminal,
    sent,
    answers,
    quits: () => quit,
    stops: () => stops,
    running: (result: 'stopped' | 'stopping' | 'idle') => (stopResult = result),
    /** What the classic screen shows now, escape codes kept. */
    raw: () => tui.render(80).join('\n'),
    /** What the screen shows now, as text: the lines of every part, without styling. */
    text: () =>
      view
        ? stripTerminalSequences(renderToString(createElement(ReactScreen, view.snapshot)))
        : tui
            .render(80)
            .map((line) => stripTerminalSequences(line).trimEnd())
            .join('\n'),
    type: async (data: string) => {
      terminal.type(data);
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  };
}

describe.each(['classic', 'react'] as const)('ChatScreen (%s)', (renderer) => {
  const open = () => openScreen(renderer);

  it('shows the conversation’s text as lines, and the line being written under them', async () => {
    const { screen, text } = open();

    screen.write('first line\nsecond ');
    expect(text()).toContain('first line');
    expect(text()).toContain('second');

    screen.write('half\n');
    expect(text()).toContain('second half');
  });

  it('keeps the blank lines between paragraphs', () => {
    const { screen, text } = open();

    screen.write('one\n\ntwo\n');
    expect(text()).toContain('one\n\ntwo');
  });

  it('draws a reply’s Markdown once its block is complete, and its raw text until then', () => {
    const { screen, text } = open();

    screen.reply.write('Some **bold** words');
    expect(text()).toContain('Some **bold** words');

    screen.reply.write('\n\n');
    expect(text()).toContain('Some bold words');
    expect(text()).not.toContain('**');
  });

  it('draws a reply’s table as a grid only when the table is complete', () => {
    const { screen, text } = open();

    screen.reply.write('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(text()).toContain('|---|---|');

    screen.reply.write('\n');
    expect(text()).toContain('│ 1 │ 2 │');
    expect(text()).not.toContain('|---|');
  });

  it('draws the lines of a reply’s code block as they arrive, before it is closed', () => {
    const { screen, text } = open();

    screen.reply.write('```ts\nconst a = 1;\nconst b');
    expect(text()).toContain('```ts\n  const a = 1;');
    expect(text()).toContain('const b');

    screen.reply.write(' = 2;\n```\n');
    expect(text()).toContain('  const a = 1;\n  const b = 2;\n```');
  });

  it('draws what is left of a reply when it ends, or when something else is written', () => {
    const { screen, text } = open();

    screen.reply.write('first **one**\n');
    screen.reply.end();
    expect(text()).toContain('first one');

    screen.reply.write('then **two**');
    screen.write('\n\n⏺ a step\n');
    expect(text()).toContain('then two\n\n⏺ a step');
  });

  it('draws a reply left open when the screen stops', () => {
    const { screen, text } = open();

    screen.reply.write('unfinished `code`');
    screen.stop();
    expect(text()).toContain('unfinished code');
  });

  it('shows a message the user sent, set apart by blank lines', () => {
    const { screen, text } = open();

    screen.echo('fix the bug\nin a.ts');
    // The blank row under the message carries a mark, so it holds a space on the React screen.
    expect(text()).toMatch(/\n› fix the bug\n {2}in a\.ts\n *\n/);
  });

  it('sends a typed line when Enter is pressed, and empties the editor', async () => {
    const { type, sent, text } = open();

    await type('hello there');
    await type(ENTER);

    expect(sent).toEqual(['hello there']);
    expect(text()).not.toContain('hello there');
  });

  it('does not send an empty line', async () => {
    const { type, sent } = open();

    await type(ENTER);
    await type('   ');
    await type(ENTER);

    expect(sent).toEqual([]);
  });

  it('shows the lines waiting, and the model, mode and state in the status line', () => {
    const { screen, text } = open();

    screen.setQueue(['one', 'two']);
    screen.setStatus({ state: 'working', model: 'Deep', mode: 'always_ask' });

    expect(text()).toContain('2 queued: "one", "two"');
    expect(text()).toContain('working');
    expect(text()).toContain('Deep · mode: always_ask');
  });

  describe('an approval', () => {
    it('shows the exact temporary grant and sends the session decision without auto-selecting it', async () => {
      const { screen, type, answers, text } = open();

      screen.ask({
        ...request('a1'),
        options: ['approve', 'allow_session', 'always_allow', 'skip', 'skip_with_message'],
        keeps: ['npm run test *'],
      });
      await type(ENTER);
      expect(answers).toEqual([]);
      expect(text()).toContain('Allow for this session');
      expect(text()).toContain('not saved');
      await type('2');
      await type(ENTER);

      expect(answers).toEqual([{ id: 'a1', response: { decision: 'allow_session' } }]);
    });

    it('is asked about with its options, and the status says it waits for the user', () => {
      const { screen, text } = open();

      screen.ask(request('a1'));

      expect(text()).toContain('Run npm test a1?');
      expect(text()).toContain('1. Run it once');
      expect(text()).toContain('4. Skip, and say what to do instead');
      expect(text()).toContain('● waiting for you');
    });

    it('is not answered by Enter on its own: nothing is chosen until the user moves', async () => {
      const { screen, type, answers } = open();

      screen.ask(request('a1'));
      await type(ENTER);
      await type(ENTER);

      expect(answers).toEqual([]);
      expect(screen.asking).toBe(true);
    });

    it('is answered by choosing with the arrows and pressing Enter', async () => {
      const { screen, type, answers, text } = open();

      screen.ask(request('a1'));
      await type(DOWN);
      await type(DOWN);
      expect(text()).toContain('→ 2. Always allow');
      await type(ENTER);

      expect(answers).toEqual([{ id: 'a1', response: { decision: 'always_allow' } }]);
      expect(screen.asking).toBe(false);
      expect(text()).toContain('● ready');
    });

    it('starts at the last choice when the first key is up, which asks for a message', async () => {
      const { screen, type, answers, text } = open();

      screen.ask(request('a1'));
      await type(UP);
      expect(text()).toContain('→ 4. Skip, and say what to do instead');
      await type(ENTER);

      expect(answers).toEqual([]);
      expect(text()).toContain('Type what it should do instead');
      expect(screen.asking).toBe(true);
    });

    it('is answered by its number and Enter', async () => {
      const { screen, type, answers } = open();

      screen.ask(request('a1'));
      await type('1');
      await type(ENTER);

      expect(answers).toEqual([{ id: 'a1', response: { decision: 'approve' } }]);
    });

    it('is skipped by Esc, with no choice made', async () => {
      const { screen, type, answers } = open();

      screen.ask(request('a1'));
      await type(ESC);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(answers).toEqual([{ id: 'a1', response: { decision: 'skip' } }]);
      expect(screen.asking).toBe(false);
    });

    it('asks for a message first when the user wants to say what to do instead', async () => {
      const { screen, type, answers, sent, text } = open();

      screen.ask(request('a1'));
      await type('4');
      await type(ENTER);
      expect(text()).toContain('Type what it should do instead');
      expect(answers).toEqual([]);

      await type('use ls instead');
      await type(ENTER);

      expect(answers).toEqual([
        { id: 'a1', response: { decision: 'skip_with_message', message: 'use ls instead' } },
      ]);
      expect(sent).toEqual([]);
    });

    it('goes back from typing a message with Esc, keeping the question', async () => {
      const { screen, type, answers, text } = open();

      screen.ask(request('a1'));
      await type('4');
      await type(ENTER);
      await type('half a mess');
      await type(ESC);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(answers).toEqual([]);
      expect(text()).toContain('1. Run it once');
      expect(screen.asking).toBe(true);
    });

    it('lets a half-typed line be sent with Enter instead of answering the question', async () => {
      const { screen, type, answers, sent } = open();

      screen.ask(request('a1'));
      await type('also check');
      await type(ENTER);

      expect(sent).toEqual(['also check']);
      expect(answers).toEqual([]);
      expect(screen.asking).toBe(true);
    });

    it('types digits into the line, not into the question, once typing has begun', async () => {
      const { screen, type, answers, sent } = open();

      screen.ask(request('a1'));
      await type('a');
      await type('2');
      await type(ENTER);

      expect(sent).toEqual(['a2']);
      expect(answers).toEqual([]);
    });

    it('shows the next one after one is answered, with nothing chosen', async () => {
      const { screen, type, answers, text } = open();

      screen.ask(request('a1'));
      screen.ask(request('a2'));
      expect(text()).toContain('+1 more waiting');

      await type('1');
      await type(ENTER);

      expect(answers).toHaveLength(1);
      expect(text()).toContain('Run npm test a2?');
      expect(text()).not.toContain('→');
    });

    it('goes away when it is answered somewhere else', async () => {
      const { screen, text } = open();

      screen.ask(request('a1'));
      screen.forget(approvalIdSchema.parse('a1'));

      expect(text()).not.toContain('Run npm test');
      expect(screen.asking).toBe(false);
    });
  });

  describe('Ctrl+C', () => {
    it('stops a running prompt and skips the approvals it waits on, without quitting', async () => {
      const { screen, type, answers, quits, stops, running } = open();

      running('stopped');
      screen.ask(request('a1'));
      screen.ask(request('a2'));
      await type(CTRL_C);

      expect(stops()).toBe(1);
      expect(answers).toEqual([
        { id: 'a1', response: { decision: 'skip' } },
        { id: 'a2', response: { decision: 'skip' } },
      ]);
      expect(screen.asking).toBe(false);
      expect(quits()).toBe(0);
    });

    it('asks to be pressed again when nothing runs, and quits on the second press', async () => {
      const { type, quits, text } = open();

      await type(CTRL_C);
      expect(quits()).toBe(0);
      expect(text()).toContain('Press Ctrl+C again to quit');

      await type(CTRL_C);
      expect(quits()).toBe(1);
    });
  });

  describe('Ctrl+D', () => {
    const CTRL_D = '\u0004';

    it('leaves on an empty line, as in a shell', async () => {
      const { type, quits } = open();

      await type(CTRL_D);

      expect(quits()).toBe(1);
    });

    it('deletes a character, and does not leave, when there is text', async () => {
      const { type, quits, text } = open();

      await type('abc');
      await type('\u001b[D');
      await type(CTRL_D);

      expect(quits()).toBe(0);
      expect(text()).toContain('ab');
      expect(text()).not.toContain('abc');
    });

    it('does not leave while a question waits, where the user has not answered yet', async () => {
      const { screen, type, quits } = open();

      screen.ask(request('a1'));
      await type(CTRL_D);

      expect(quits()).toBe(0);
    });
  });

  it('leaves the terminal when stopped, keeping an unfinished line in the scrollback', () => {
    const { screen, terminal, text } = open();

    screen.write('unfinished');
    screen.stop();

    expect(terminal.stopped).toBe(true);
    expect(text()).toContain('unfinished');
  });

  it('shows the latest file change in full on Ctrl+O, set apart by blank lines', async () => {
    const { screen, type, text } = open();

    screen.write('before\n');
    await type('\u000f');

    expect(text()).toContain('before\n\na diff\nof two lines\n');
  });

  it('shows a notice apart from the conversation’s text', () => {
    const { screen, text } = open();

    screen.write('model text');
    screen.notice('→ switched');

    expect(text()).toContain('model text');
    expect(text()).toContain('→ switched');
  });
});

describe('ChatScreen (react, NO_COLOR)', () => {
  it('writes out the inline code and strike-through that styling would have shown', () => {
    vi.stubEnv('NO_COLOR', '1');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const { screen, text } = openScreen('react');

    screen.reply.write('Use `npm test`, not ~~npm run~~.\n\n');
    expect(text()).toContain('Use `npm test`, not ~~npm run~~.');
  });
});

describe('ChatScreen: themes', () => {
  it('draws its status line and a reply’s code in the palette it is given', () => {
    const { screen, raw } = openScreen('classic', createPalette(THEMES.colorblind));

    screen.reply.write('```ts\nconst a = "b";\n```\n');

    expect(raw()).toContain('\u001b[94m● ready');
    expect(raw()).toContain('\u001b[94m"b"');
    expect(raw()).not.toContain('\u001b[32m');
  });

  it('keeps the default theme when it is given none', () => {
    const { screen, raw } = openScreen('classic');

    screen.reply.write('```ts\nconst a = "b";\n```\n');

    expect(raw()).toContain('\u001b[32m● ready');
    expect(raw()).toContain('\u001b[32m"b"');
  });
});
