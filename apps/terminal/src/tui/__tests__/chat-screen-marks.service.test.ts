import { PassThrough } from 'node:stream';
import { TuiMainScreen } from '@earendil-works/pi-tui';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { carryMark, shellMarkSequence } from '../../marks/marks.utils.js';
import { ReactView } from '../../react-screen/react-view.service.js';
import { fakeTerminal } from '../../testing/terminal.fake.js';
import { ChatScreen } from '../chat-screen.service.js';

const status = { state: 'ready', model: 'Fast', mode: 'ask', tasks: 0 } as const;

function screenParts() {
  return {
    status,
    commands: ChatScreen.commands,
    cwd: process.cwd(),
    onSubmit: vi.fn(),
    onStop: () => 'idle' as const,
    onAnswer: vi.fn(),
    onQuit: vi.fn(),
    onExpand: () => '',
  };
}

function reactScreen() {
  const columns = 80;
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows: 24 });
  const view = new ReactView({
    terminal: fakeTerminal(columns, 24),
    stdout,
    status,
    commands: ChatScreen.commands,
    cwd: process.cwd(),
  });
  const screen = new ChatScreen({ ...screenParts(), view });
  let output = '';

  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => (output += chunk));
  screen.start();
  onTestFinished(() => screen.stop());

  return {
    screen,
    rows: () => view.snapshot.history.map(({ text }) => text),
    written: () => output,
  };
}

describe('ChatScreen: marks for the terminal (react)', () => {
  it('marks the message as the prompt and the row under it as where the output starts', () => {
    const { screen, rows } = reactScreen();

    screen.echo('fix the bug');

    const [before, message, after] = rows();

    expect(before).toBe('');
    expect(message?.startsWith(carryMark('prompt'))).toBe(true);
    expect(message).toContain('fix the bug');
    expect(after).toBe(`${carryMark('output')} `);
  });

  it('marks only the first row of a message that wraps', () => {
    const { screen, rows } = reactScreen();

    screen.echo('word '.repeat(40));

    expect(rows().filter((row) => row.includes(carryMark('prompt')))).toHaveLength(1);
  });

  it('closes a turn at the first row after it, with how it ended', () => {
    const { screen, rows } = reactScreen();

    screen.echo('one');
    screen.write('the answer\n\n');
    screen.endTurn('completed');
    screen.echo('two');

    const ended = rows().filter((row) => row.includes(carryMark('done')));

    expect(ended).toEqual([`${carryMark('done')} `]);
    expect(rows().indexOf(`${carryMark('done')} `)).toBeGreaterThan(rows().indexOf('the answer'));
  });

  it('closes a failed turn as failed, and each turn once', () => {
    const { screen, rows } = reactScreen();

    screen.echo('one');
    screen.endTurn('failed');
    screen.echo('two');
    screen.write('second answer\n');
    screen.endTurn('completed');
    screen.notice('later');

    expect(rows().filter((row) => row.includes(carryMark('failed')))).toHaveLength(1);
    expect(rows().filter((row) => row.includes(carryMark('done')))).toHaveLength(1);
    expect(rows().at(-1)).toContain(carryMark('done'));
  });

  it('leaves the rows of a turn that is not over unmarked', () => {
    const { screen, rows } = reactScreen();

    screen.echo('one');
    screen.write('line\n');

    expect(rows().some((row) => row.includes(carryMark('done')))).toBe(false);
    expect(rows().some((row) => row.includes(carryMark('failed')))).toBe(false);
  });

  it('puts the real OSC 133 sequences on the terminal, and no carrier', async () => {
    const { screen, written } = reactScreen();

    screen.echo('hello');
    screen.write('hi\n');
    screen.endTurn('completed');
    screen.echo('again');
    await new Promise((resolve) => setTimeout(resolve, 80));

    const output = written();

    expect(output).toContain(shellMarkSequence('prompt'));
    expect(output).toContain(shellMarkSequence('output'));
    expect(output).toContain(shellMarkSequence('done'));
    expect(output).not.toContain('\u001b[970');
    expect(output.indexOf(shellMarkSequence('prompt'))).toBeLessThan(
      output.indexOf(shellMarkSequence('output')),
    );
    expect(output.indexOf(shellMarkSequence('output'))).toBeLessThan(
      output.indexOf(shellMarkSequence('done')),
    );
  });

  it('keeps the marks when NO_COLOR strips the styling', () => {
    vi.stubEnv('NO_COLOR', '1');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const { screen, rows } = reactScreen();

    screen.echo('hello');

    expect(rows()[1]).toBe(`${carryMark('prompt')}› hello`);
  });
});

describe('ChatScreen: marks for the terminal (classic)', () => {
  it('writes the sequences at the start of the rows they mark', () => {
    const terminal = fakeTerminal();
    const tui = new TuiMainScreen(terminal);
    const screen = new ChatScreen({ ...screenParts(), tui });

    screen.start();
    onTestFinished(() => screen.stop());
    screen.echo('hello');
    screen.write('hi\n');
    screen.endTurn('failed');
    screen.echo('again');

    const rows = tui.render(80);

    expect(rows.some((row) => row.startsWith(shellMarkSequence('prompt')))).toBe(true);
    expect(rows.some((row) => row.startsWith(shellMarkSequence('output')))).toBe(true);
    expect(rows.some((row) => row.startsWith(shellMarkSequence('failed')))).toBe(true);
  });
});
