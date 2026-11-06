import type { ProgramStatus } from '@earendil-works/pi-tui';
import type { FakeTerminal } from './testing.types.js';

/**
 * Test-only: a terminal that is not one, `columns` wide, for a screen's tests: the test types at
 * it (`type`) and reads what the screen drew by rendering the screen itself. Nothing touches the
 * real stdin or stdout.
 */
export function fakeTerminal(columns = 80, rows = 24): FakeTerminal {
  let onInput: (data: string) => void = () => undefined;
  const statuses: ProgramStatus[] = [];
  let stopped = false;

  return {
    start: (input) => {
      onInput = input;
      stopped = false;
    },
    stop: () => {
      stopped = true;
    },
    drainInput: () => Promise.resolve(),
    write: () => undefined,
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => undefined,
    hideCursor: () => undefined,
    showCursor: () => undefined,
    clearLine: () => undefined,
    clearFromCursor: () => undefined,
    clearScreen: () => undefined,
    setTitle: () => undefined,
    setProgress: () => undefined,
    setProgramStatus: (status) => {
      statuses.push(status);
    },
    type: (data) => onInput(data),
    statuses,
    get stopped() {
      return stopped;
    },
  };
}
