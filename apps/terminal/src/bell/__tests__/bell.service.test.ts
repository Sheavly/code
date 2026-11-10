import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { now } from '@sheavly/core/clock/clock.helper';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { APPROVAL_SETTLE_MS } from '../bell.constants.js';
import { TerminalBell } from '../bell.service.js';

const clock = useFixedClock();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function open(enabled = true) {
  const write = vi.fn();
  const bell = new TerminalBell({ enabled, write });

  bell.startTurn();

  return { bell, write };
}

const tool = (id = 'call-1', age = 0) => ({ id, description: 'Run tests', startedAt: now() - age });
const advance = (ms: number) => {
  clock.advance(ms);
  vi.advanceTimersByTime(ms);
};

describe('TerminalBell', () => {
  it('does nothing when disabled, including scheduling no tool timers', () => {
    const { bell, write } = open(false);

    bell.requestApproval('approval-1');
    bell.watchTools([tool()]);
    expect(vi.getTimerCount()).toBe(0);
    advance(6000);
    bell.replyCompleted();
    expect(write).not.toHaveBeenCalled();
  });

  it('sends one raw BEL per completed reply, not rendered text', () => {
    const { bell, write } = open();

    bell.replyCompleted();
    bell.replyCompleted();
    expect(write.mock.calls).toEqual([['\u0007']]);
    bell.startTurn();
    bell.replyCompleted();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('rings for a new approval once, not for repeated updates of the same request', () => {
    const { bell, write } = open();

    bell.requestApproval('a1');
    bell.requestApproval('a1');
    bell.requestApproval('a2');
    advance(APPROVAL_SETTLE_MS);
    expect(write).toHaveBeenCalledTimes(2);
    bell.forgetApproval('a1');
    bell.requestApproval('a1');
    advance(APPROVAL_SETTLE_MS);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('stays silent for a replayed approval that was already answered', () => {
    const { bell, write } = open();

    bell.requestApproval('old');
    bell.forgetApproval('old');
    advance(APPROVAL_SETTLE_MS * 2);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rings at five seconds once per live call without postponing on new snapshots', () => {
    const { bell, write } = open();
    const running = tool();

    bell.watchTools([running]);
    advance(2000);
    bell.watchTools([{ ...running }]);
    advance(2999);
    expect(write).not.toHaveBeenCalled();
    advance(1);
    expect(write).toHaveBeenCalledTimes(1);
    bell.watchTools([{ ...running }]);
    advance(10000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses each call’s own start time for parallel tools', () => {
    const { bell, write } = open();

    bell.watchTools([tool('old', 4000), tool('new')]);
    advance(1000);
    expect(write).toHaveBeenCalledTimes(1);
    advance(4000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('cancels a finished tool before its threshold and allows a later call to reuse its id', () => {
    const { bell, write } = open();

    bell.watchTools([tool()]);
    advance(4999);
    bell.watchTools([]);
    advance(1);
    expect(write).not.toHaveBeenCalled();
    bell.watchTools([tool()]);
    advance(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('clears pending alerts when a turn fails or is cancelled, including late tool snapshots', () => {
    const { bell, write } = open();

    bell.watchTools([tool()]);
    bell.finishTurn();
    bell.watchTools([tool()]);
    bell.replyCompleted();
    advance(6000);
    expect(vi.getTimerCount()).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('silences a closed chat permanently and releases its timers', () => {
    const { bell, write } = open();

    bell.watchTools([tool()]);
    bell.stop();
    bell.startTurn();
    bell.watchTools([tool()]);
    bell.requestApproval('a1');
    bell.replyCompleted();
    advance(6000);
    expect(vi.getTimerCount()).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });
});
