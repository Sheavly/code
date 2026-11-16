import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { SAME_KEYPRESS_MS } from '../../render/render.constants.js';
import { abortingStop, interruptOnCtrlC } from '../interrupt.helper.js';
import type { StopResult } from '../interrupt.types.js';

const clock = useFixedClock();

function ctrlC(stops: StopResult[] = []) {
  const source = new EventEmitter();
  const order: string[] = [];
  const stop = vi.fn<() => StopResult>(() => stops.shift() ?? 'idle');
  const forceQuit = vi.fn(async () => {
    order.push('cleanup');
  });
  const exit = vi.fn((code: number) => {
    order.push(`exit ${String(code)}`);
  });
  const write = vi.fn<(text: string) => void>();
  const onIdle = vi.fn();
  const handle = interruptOnCtrlC({ write, stop, forceQuit, onIdle, source, exit });

  return {
    source,
    order,
    stop,
    forceQuit,
    exit,
    write,
    onIdle,
    handle,
    press: () => source.emit('SIGINT'),
  };
}

describe('interruptOnCtrlC', () => {
  it('stops the work on the first press and says a second one force-quits', () => {
    const chat = ctrlC(['stopped']);

    chat.press();
    expect(chat.stop).toHaveBeenCalledOnce();
    expect(chat.write).toHaveBeenCalledWith(expect.stringContaining('Ctrl+C again to force quit'));
    expect(chat.forceQuit).not.toHaveBeenCalled();
  });

  it('treats a second press within the window as the same keypress', () => {
    const chat = ctrlC(['stopped', 'stopping']);

    chat.press();
    clock.advance(SAME_KEYPRESS_MS - 1);
    chat.press();
    expect(chat.stop).toHaveBeenCalledOnce();
    expect(chat.forceQuit).not.toHaveBeenCalled();
  });

  it('force-quits on a second press after the window: cleanup first, then exit 130', async () => {
    const chat = ctrlC(['stopped', 'stopping']);

    chat.press();
    clock.advance(SAME_KEYPRESS_MS);
    chat.press();
    expect(chat.write).toHaveBeenCalledWith('\n✗ Forced exit.\n');
    expect(chat.exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(chat.exit).toHaveBeenCalledWith(130));
    expect(chat.order).toEqual(['cleanup', 'exit 130']);
  });

  it('still exits 130 when the cleanup fails, and says so', async () => {
    const chat = ctrlC(['stopping']);

    chat.forceQuit.mockRejectedValueOnce(new Error('close failed'));
    chat.press();
    await vi.waitFor(() => expect(chat.exit).toHaveBeenCalledWith(130));
    expect(chat.write).toHaveBeenCalledWith('✗ Cleanup failed: close failed\n');
  });

  it('runs the cleanup once however many presses follow a force quit', async () => {
    const chat = ctrlC(['stopping']);

    chat.press();
    clock.advance(SAME_KEYPRESS_MS);
    chat.press();
    await vi.waitFor(() => expect(chat.exit).toHaveBeenCalledOnce());
    expect(chat.forceQuit).toHaveBeenCalledOnce();
  });

  it('calls onIdle when nothing runs, and ignores presses after it', () => {
    const chat = ctrlC(['idle']);

    chat.press();
    clock.advance(SAME_KEYPRESS_MS);
    chat.press();
    expect(chat.onIdle).toHaveBeenCalledOnce();
    expect(chat.forceQuit).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', () => {
    const chat = ctrlC(['stopped']);

    chat.handle.dispose();
    chat.press();
    expect(chat.stop).not.toHaveBeenCalled();
  });
});

describe('abortingStop', () => {
  it('aborts on the first call and reports stopping after', () => {
    const controller = new AbortController();
    const stop = abortingStop(controller);

    expect(stop()).toBe('stopped');
    expect(controller.signal.aborted).toBe(true);
    expect(stop()).toBe('stopping');
  });
});
