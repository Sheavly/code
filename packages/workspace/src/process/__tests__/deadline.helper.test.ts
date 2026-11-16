import { describe, expect, it } from 'vitest';
import { withDeadline } from '../deadline.helper.js';

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe('withDeadline', () => {
  it('has no deadline without timeoutMs: it is the caller signal and never times out', async () => {
    const caller = new AbortController();
    const deadline = withDeadline({ signal: caller.signal });

    expect(deadline.signal).toBe(caller.signal);

    caller.abort();

    expect(deadline.timedOut()).toBe(false);
  });

  it('times out once the time runs out, and aborts its signal', async () => {
    const deadline = withDeadline({ signal: new AbortController().signal, timeoutMs: 20 });

    expect(deadline.timedOut()).toBe(false);
    await wait(60);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
  });

  it('does not call it a timeout when the caller aborted, before or after the time ran out', async () => {
    const caller = new AbortController();
    const early = withDeadline({ signal: caller.signal, timeoutMs: 10_000 });

    caller.abort();

    expect(early.signal.aborted).toBe(true);
    expect(early.timedOut()).toBe(false);

    const late = new AbortController();
    const afterTime = withDeadline({ signal: late.signal, timeoutMs: 20 });

    await wait(60);
    late.abort();

    expect(afterTime.timedOut()).toBe(false);
  });
});
