import type { SampleContext } from './stream-agent.types.js';

/**
 * Passes reasoning activity to the ordered queue as transitions only: a provider may repeat a
 * value or nest blocks, but the wire carries one start and one end. `close` ends activity a cut
 * stream, abort or failure left open, so a UI never keeps showing it.
 */
export function createReasoningActivity(events: SampleContext['events']) {
  let active = false;

  const set = (next: boolean): void => {
    if (next === active) return;
    active = next;
    events.enqueue({ type: 'reasoning_activity', active });
  };

  return { set, close: () => set(false) };
}
