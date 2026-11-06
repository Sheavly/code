import { ProcessTerminal } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { ScrollbackTerminal } from '../scrollback-terminal.service.js';

describe('ScrollbackTerminal', () => {
  it('drops erase-scrollback controls, including ones split between output chunks', () => {
    const write = vi.spyOn(ProcessTerminal.prototype, 'write').mockImplementation(() => undefined);
    const terminal = new ScrollbackTerminal();

    try {
      terminal.write('before\u001b[2J\u001b[H\u001b[3Jafter');
      terminal.write('\u001b[');
      terminal.write('3');
      terminal.write('Jtail');
      expect(write.mock.calls.map(([data]) => data).join('')).toBe(
        'before\u001b[2J\u001b[Haftertail',
      );
    } finally {
      write.mockRestore();
    }
  });

  it('preserves other controls, including a colour sequence sharing the same prefix', () => {
    const write = vi.spyOn(ProcessTerminal.prototype, 'write').mockImplementation(() => undefined);
    const terminal = new ScrollbackTerminal();

    try {
      terminal.write('\u001b[3');
      terminal.write('1mred\u001b[0m\u0007');
      expect(write.mock.calls.map(([data]) => data).join('')).toBe('\u001b[31mred\u001b[0m\u0007');
    } finally {
      write.mockRestore();
    }
  });
});
