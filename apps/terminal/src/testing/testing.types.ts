import type { ProgramStatus, Terminal } from '@earendil-works/pi-tui';

/** Test-only: a terminal that is not one; see `fakeTerminal`. */
export type FakeTerminal = Terminal & {
  /** Types `data` at the program, as the terminal would pass a key or a paste. */
  type(data: string): void;
  /** Every program status it was told, in order. */
  readonly statuses: ProgramStatus[];
  /** Whether the program left it stopped. */
  readonly stopped: boolean;
};
