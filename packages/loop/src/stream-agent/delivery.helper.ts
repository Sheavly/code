import { now } from '@sheavly/core/clock/clock.helper';
import { inboxText } from '@sheavly/runtime/sessions/sessions.utils';
import type { HarnessNotice } from '@sheavly/protocol/notice/notice.types';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import { runNotice, runTaskCompleted } from '../hooks/new-points.helper.js';
import { publishNotice } from './notice-publish.helper.js';
import type { TurnContext } from './stream-agent.types.js';

/** The notice kinds `notice` hooks never see, so a hook cannot be triggered by its own effects. */
const HOOK_BLIND_NOTICES: ReadonlySet<HarnessNotice['kind']> = new Set([
  'hook-failed',
  'extension-notice',
]);

/**
 * Messages sent to this session while it worked (its parent's, for example): put in
 * history as user messages before the model call, and shown in order, like finished tasks.
 */
export function deliverMessages(context: TurnContext): void {
  const { session, messages, events } = context;

  for (const message of session.registry.takeMessages(session.ref.id)) {
    events.enqueue({ type: 'message_received', message });
    // The message is stamped with when it was sent, not when this turn read it.
    messages.push({ role: 'user', content: inboxText(message), at: message.sentAt });
  }
}

/**
 * The notices extensions queued for this session since the last turn: each is published (the
 * stream event, then the history entry, in the order queued) before the model call. The outbox is
 * taken whole before the first is published, so none is delivered twice; the cost is that a
 * failure in the middle drops the rest of that batch, reported once as a hook failure.
 */
export function deliverExtensionNotices(context: TurnContext): void {
  const { session, messages, events } = context;

  for (const notice of session.registry.takeNotices(session.ref.id)) {
    publishNotice({ events, messages, notice, at: now() });
  }
}

/**
 * Runs the `taskCompleted` hooks once per delivery of finished work, then the `notice` hooks for
 * each persistent notice the harness wrote into history since `noticesFrom` (finished work and
 * failed hooks). Transient notices ride one call and are not offered. A `hook-failed` notice is
 * not offered to `notice` hooks: a hook failing on its own failure would repeat forever. Neither
 * is an `extension-notice`: a hook that reacts to one by making an extension emit another would
 * feed itself, and extension text is not the harness's to trigger hooks with.
 */
export async function runDeliveryHooks(params: {
  context: TurnContext;
  delivered: readonly TaskInfo[][];
  noticesFrom: number;
}): Promise<void> {
  const { context, delivered, noticesFrom } = params;
  const { options, messages, signal, events, hookFailures } = context;
  const base = {
    hooks: options.hooks ?? [],
    messages,
    signal,
    onContext: (added: { hook: string; content: string }) =>
      events.enqueue({ type: 'context_added', ...added }),
    onHookError: hookFailures.report,
  };

  for (const tasks of delivered) await runTaskCompleted({ ...base, tasks });

  const notices = messages
    .slice(noticesFrom)
    .flatMap((message) =>
      message.role === 'notice' && !HOOK_BLIND_NOTICES.has(message.notice.kind)
        ? [message.notice]
        : [],
    );

  for (const notice of notices) await runNotice({ ...base, notice });
}
