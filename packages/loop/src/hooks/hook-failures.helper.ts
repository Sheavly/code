import { now } from '@sheavly/core/clock/clock.helper';
import { redactDiagnosticText } from '@sheavly/runtime/errors/diagnostic-text.utils';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { AgentEvents } from '../stream-agent/stream-agent.types.js';
import type { HookError } from '../errors/loop.errors.js';
import { MAX_HOOK_FAILED_ERROR_CHARS } from '@sheavly/protocol/notice/notice.constants';
import type { HookFailures } from './hooks.types.js';

type HookFailedNotice = Extract<HarnessNotice, { kind: 'hook-failed' }>;

/**
 * One run's failed hook handlers. `report` is the `onHookError` every runner gets: it emits
 * `hook_failed` at once, so a UI hears every failure, and keeps the failure until `deliver` puts
 * it in front of the model. Each round a hook's handler fails gets one notice, carrying that
 * round's error, so the model hears of a hook that keeps failing and can tell the user; further
 * failures of the same handler within the round are folded into a `repeats` count.
 */
export function createHookFailures(events: AgentEvents): HookFailures {
  const pending = new Map<string, { notice: HookFailedNotice; count: number }>();

  return {
    report(failure: HookError): void {
      const error = redactDiagnosticText(failure.message);
      const key = `${failure.hook}\u0000${failure.handler}`;
      const waiting = pending.get(key);

      events.enqueue({ type: 'hook_failed', hook: failure.hook, handler: failure.handler, error });

      if (waiting) {
        waiting.count += 1;

        return;
      }

      pending.set(key, {
        notice: {
          kind: 'hook-failed',
          hook: failure.hook,
          handler: failure.handler,
          error: error.slice(0, MAX_HOOK_FAILED_ERROR_CHARS),
        },
        count: 1,
      });
    },

    deliver(messages: HistoryMessage[]): void {
      for (const { notice, count } of pending.values()) {
        const delivered: HookFailedNotice = count > 1 ? { ...notice, repeats: count - 1 } : notice;

        events.enqueue({ type: 'harness_notice', notice: delivered });
        messages.push({ role: 'notice', notice: delivered, at: now() });
      }

      pending.clear();
    },
  };
}
