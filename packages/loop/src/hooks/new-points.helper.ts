import type { Hook } from '@sheavly/core/hook/hook.types';
import type { ApprovalRequest } from '@sheavly/protocol/approval/approval.types';
import type { DoneReason } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import { contextAdder } from './hooks.helper.js';
import { viewOf } from '../summary/summary.utils.js';
import { HookError } from '../errors/loop.errors.js';
import { APPROVAL_HOOK_TIMEOUT_MS, SESSION_END_TIMEOUT_MS } from './hooks.constants.js';
import { guarded, withTimeout } from './guarded.helper.js';
import type { OnHookError } from './hooks.types.js';

/** Someone to tell about every context addition (the loop emits `context_added`). */
type OnContext = (added: { hook: string; content: string }) => void;

/** What the context-adding hook points share: the history, the abort and where context goes. */
type ContextRun = {
  hooks: Hook[];
  messages: HistoryMessage[];
  signal: AbortSignal;
  onContext: OnContext;
  onHookError: OnHookError;
};

const addContextFor = (params: { hook: Hook; run: ContextRun }) =>
  contextAdder({ hook: params.hook, ...params.run });

/** Runs every `taskCompleted` handler for one delivery of finished work, in hook order. */
export async function runTaskCompleted(
  params: ContextRun & { tasks: readonly TaskInfo[] },
): Promise<void> {
  const { hooks, messages, signal, onHookError, tasks } = params;

  for (const hook of hooks) {
    const { taskCompleted } = hook;

    if (!taskCompleted || signal.aborted) continue;
    await guarded({
      hook,
      handler: 'taskCompleted',
      signal,
      onHookError,
      work: () =>
        taskCompleted({
          messages: viewOf(messages),
          signal,
          addContext: addContextFor({ hook, run: params }),
          tasks: structuredClone(tasks),
        }),
    });
  }
}

/** Runs every `notice` handler for one harness notice, in hook order. */
export async function runNotice(params: ContextRun & { notice: HarnessNotice }): Promise<void> {
  const { hooks, messages, signal, onHookError, notice } = params;

  for (const hook of hooks) {
    const { notice: handler } = hook;

    if (!handler || signal.aborted) continue;
    await guarded({
      hook,
      handler: 'notice',
      signal,
      onHookError,
      work: () =>
        handler({
          messages: viewOf(messages),
          signal,
          addContext: addContextFor({ hook, run: params }),
          notice: structuredClone(notice),
        }),
    });
  }
}

/**
 * Runs every `sessionEnd` handler once, when the run's outcome is known. It runs after an abort
 * too (that is when a hook most wants to clean up), so the wait is not raced against the run's
 * signal; the handler still receives it to stop its own work. Each handler has `timeoutMs`: one
 * that hangs is reported as failed and the run ends without it, since `done` waits on this.
 */
export async function runSessionEnd(params: {
  hooks: Hook[];
  outcome: DoneReason;
  messages: HistoryMessage[];
  signal: AbortSignal;
  onHookError: OnHookError;
  timeoutMs?: number;
}): Promise<void> {
  const {
    hooks,
    outcome,
    messages,
    signal,
    onHookError,
    timeoutMs = SESSION_END_TIMEOUT_MS,
  } = params;
  const never = new AbortController().signal;

  for (const hook of hooks) {
    const { sessionEnd } = hook;

    if (!sessionEnd) continue;
    await guarded({
      hook,
      handler: 'sessionEnd',
      signal: never,
      onHookError,
      work: () =>
        withTimeout({
          work: sessionEnd({ outcome, messages: viewOf(messages), signal }),
          timeoutMs,
        }),
    });
  }
}

/**
 * The screener a run registers on the approval registry: it offers a request made by this
 * session to each `approval` handler in order, and the first answer settles it. A handler that
 * throws is reported (`hook_failed`, and a notice to the model) and then thrown on, so the
 * registry fails closed and the command is skipped. Requests from other sessions are left to
 * their own run's hooks.
 */
export function approvalScreener(params: {
  hooks: Hook[];
  sessionId: SessionId;
  onHookError: OnHookError;
}) {
  const { hooks, sessionId, onHookError } = params;

  return async ({
    request,
    signal,
  }: {
    request: ApprovalRequest;
    signal: AbortSignal;
  }): Promise<unknown> => {
    if (request.sessionId !== sessionId) return undefined;

    for (const hook of hooks) {
      const { approval } = hook;

      if (!approval || signal.aborted) continue;

      // Bounded: a hanging hook must not stall every approval; it times out and fails closed.
      const result = await guarded({
        hook,
        handler: 'approval',
        signal,
        onHookError,
        work: () =>
          withTimeout({
            work: approval({ request: structuredClone(request), signal }),
            timeoutMs: APPROVAL_HOOK_TIMEOUT_MS,
          }),
      });

      if (!result.ok) {
        throw new HookError({ hook: hook.name, handler: 'approval', cause: result.error });
      }

      if (result.value !== undefined) return result.value;
    }

    return undefined;
  };
}
