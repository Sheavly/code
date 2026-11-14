import { STATUS_TABLE } from './status.constants.js';
import type { Machine, StateOf } from './status.types.js';

/** Whether `machine` may move from state `from` to state `to`, as the status table says. */
export function canTransition<M extends Machine>(params: {
  machine: M;
  from: StateOf<M>;
  to: StateOf<M>;
}): boolean {
  const { machine, from, to } = params;
  const rows: Record<string, readonly string[]> = STATUS_TABLE[machine];

  return rows[from]?.includes(to) ?? false;
}

/**
 * Whether a session's `state`, `lastOutcome` and `endedAt` do not contradict each other: an open
 * session (running or idle) has not ended, and an ended one's last outcome, when it has one, is
 * its state. A missing field is not a contradiction, so a conversation stored before the fields
 * were always set still reads.
 */
export function isConsistentSession(session: {
  state: StateOf<'session'>;
  lastOutcome?: StateOf<'session'> | undefined;
  endedAt?: number | undefined;
}): boolean {
  const { state, lastOutcome, endedAt } = session;

  if (state === 'running' || state === 'idle') return endedAt === undefined;

  return lastOutcome === undefined || lastOutcome === state;
}

/** The status table as the Markdown the state-machines guide prints, one row per state. */
export function statusTableMarkdown(): string {
  const machines: Record<string, Record<string, readonly string[]>> = STATUS_TABLE;
  const rows = Object.entries(machines).flatMap(([machine, states]) =>
    Object.entries(states).map(([state, next]) => {
      const to = next.length === 0 ? 'final' : next.join(', ');

      return `| ${machine} | \`${state}\` | ${to} |`;
    }),
  );

  return ['| Machine | State | May move to |', '| --- | --- | --- |', ...rows].join('\n');
}
