import { describe, expect, it } from 'vitest';
import { stripTerminalSequences, TuiMainScreen } from '@earendil-works/pi-tui';
import { fakeTerminal } from '../../testing/terminal.fake.js';
import { SetupScreen } from '../setup-screen.service.js';
import { SetupCancelledError } from '../../errors/setup.errors.js';

function open() {
  const terminal = fakeTerminal();
  const writes: string[] = [];

  terminal.write = (text) => {
    writes.push(text);
  };

  const tui = new TuiMainScreen(terminal);
  const screen = new SetupScreen(tui);

  screen.start();

  return {
    terminal,
    tui,
    screen,
    writes,
    text: () => tui.render(80).map(stripTerminalSequences).join('\n'),
  };
}

describe('SetupScreen', () => {
  it('masks a pasted key in every frame and clears it on submission', async () => {
    const { screen, terminal, text, writes } = open();

    try {
      const answer = screen.text({ title: 'API key', secret: true });

      terminal.type('\u001b[200~secret-key-value\u001b[201~');
      expect(text()).toContain('•••');
      expect(text()).not.toContain('secret-key-value');
      terminal.type('\r');
      await expect(answer).resolves.toBe('secret-key-value');
      expect(text()).not.toContain('secret-key-value');
      expect(writes.join('')).not.toContain('secret-key-value');
    } finally {
      screen.stop();
    }
  });

  it('keeps an invalid field open for correction', async () => {
    const { screen, terminal, text } = open();

    try {
      const answer = screen.text({
        title: 'Name',
        validate: (value) => (value ? undefined : 'Required'),
      });

      terminal.type('\r');
      expect(text()).toContain('Required');
      terminal.type('Personal');
      terminal.type('\r');
      await expect(answer).resolves.toBe('Personal');
    } finally {
      screen.stop();
    }
  });

  it('preselects an existing option when editing settings', async () => {
    const { screen, terminal } = open();

    try {
      const answer = screen.choose({
        title: 'Reasoning',
        initial: 'false',
        items: [
          { value: 'true', label: 'Enabled' },
          { value: 'false', label: 'Disabled' },
        ],
      });

      terminal.type('\r');
      await expect(answer).resolves.toBe('false');
    } finally {
      screen.stop();
    }
  });

  it.each(['\u0003', '\u001b'])('cancels input and the API signal with %j', async (key) => {
    const { screen, terminal } = open();
    const answer = screen.text({ title: 'API key', secret: true });
    const rejected = expect(answer).rejects.toBeInstanceOf(SetupCancelledError);

    terminal.type(key);
    await rejected;
    screen.stop();
    expect(screen.signal.aborted).toBe(true);
    expect(terminal.stopped).toBe(true);
  });
});
