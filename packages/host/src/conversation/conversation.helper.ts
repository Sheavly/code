import { now } from '@sheavly/core/clock/clock.helper';
import { randomUUID } from 'node:crypto';
import { messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { defineHook } from '@sheavly/core/hook/hook.utils';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { Conversation, ConversationOptions } from './conversation.types.js';

/**
 * A conversation on the harness's main session. Every prompt runs `options.run` (the loop's
 * `streamAgent`) on the history so far with `keepSession`, so the session goes idle between
 * prompts instead of ending, and the next prompt resumes it. Finite background tasks, including
 * sub-agents, keep the prompt alive and wake the model with their completions; services may
 * outlive it. An interrupted prompt leaves history
 * valid to continue from; a failed one keeps the completed work and the user's prompt too.
 */
export function createConversation(options: ConversationOptions): Conversation {
  const { harness, run, tools, hooks = [] } = options;
  const { sessions, mainSession, tasks, provider } = harness;
  /** Stops the running prompt when the conversation closes. */
  const closing = new AbortController();
  let messages: HistoryMessage[] = [...(options.messages ?? [])];
  let running = false;
  let started = options.resumed ?? false;
  let runSignal: AbortSignal | undefined;
  /** Aborted by `yieldPrompt`; replaced for each prompt. */
  let yielding = new AbortController();
  /** Set by the first close(): the cleanup every close() call waits for. */
  let closed: Promise<void> | undefined;

  function refuse(params: { reason: 'session_running' | 'session_ended'; why: string }): never {
    const { reason, why } = params;

    throw new SessionError({ reason, sessionId: mainSession.id, message: why });
  }

  /**
   * One prompt's events. Its run is driven here, not just passed through: if the caller stops
   * iterating early, the prompt is stopped like an interrupt and its run is drained to its `done`,
   * so its history is kept and the session is idle again before the next `send`.
   */
  async function* prompt(params: {
    user: Message;
    resumed: boolean;
    signal: AbortSignal;
    yieldSignal: AbortSignal;
  }): AsyncGenerator<AgentEvent> {
    const stop = new AbortController();
    const signal = AbortSignal.any([
      stop.signal,
      closing.signal,
      ...(params.signal ? [params.signal] : []),
    ]);
    const { user } = params;

    runSignal = signal;
    const events = run({
      provider,
      tools,
      hooks: [
        ...hooks,
        defineHook({
          name: 'conversation-history',
          onError: async (context) => {
            messages = [...context.messages];
          },
        }),
      ],
      messages: [...messages, user],
      signal,
      tasks,
      session: { registry: sessions, ref: mainSession },
      keepSession: true,
      ...(options.keepHistory && { keepHistory: options.keepHistory }),
      yieldSignal: params.yieldSignal,
      resumed: params.resumed,
      instructions: options.instructions ?? harness.instructions,
      ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
      ...(options.summary && { summary: options.summary }),
    })[Symbol.asyncIterator]();
    const record = (event: AgentEvent) => {
      if (event.type !== 'done') return;
      messages = event.messages;
    };
    let finished = false;

    // The user's prompt is recorded before the run, so a crash mid-run does not lose it.
    options.keepHistory?.([...messages, user]);

    try {
      for (let next = await events.next(); !next.done; next = await events.next()) {
        record(next.value);
        yield next.value;
      }

      finished = true;
    } finally {
      // Stopped before its end (the caller broke off, or the run threw): stop it and read the rest.
      if (!finished) {
        stop.abort();

        for (let next = await events.next(); !next.done; next = await events.next()) {
          record(next.value);
        }
      }

      running = false;
      runSignal = undefined;
      // Provider failures do not undo tool effects, so their completed work must stay in history.
      options.keepHistory?.(messages);
    }
  }

  return {
    send(text, sendOptions = {}) {
      if (closed) {
        refuse({ reason: 'session_ended', why: 'This conversation is closed; start a new one' });
      }

      if (running) {
        refuse({
          reason: 'session_running',
          why: 'A prompt is still running in this conversation: wait for it to finish, or stop it, before sending the next',
        });
      }

      // The main session runs from its start; every later prompt resumes it from idle.
      const messageId = messageIdSchema.parse(randomUUID());

      sessions.setMessage({ sessionId: mainSession.id, messageId });
      const resumed = started;

      if (resumed) sessions.resume(mainSession.id);
      started = true;
      running = true;
      yielding = new AbortController();
      runSignal = AbortSignal.any([
        closing.signal,
        ...(sendOptions.signal ? [sendOptions.signal] : []),
      ]);
      const user: Message = {
        role: 'user',
        id: messageId,
        content: text,
        ...(sendOptions.parts && { parts: sendOptions.parts }),
        at: now(),
      };

      return prompt({ user, resumed, signal: runSignal, yieldSignal: yielding.signal });
    },
    yieldPrompt() {
      if (closed) {
        refuse({ reason: 'session_ended', why: 'This conversation is closed; start a new one' });
      }

      if (!running || runSignal?.aborted) return false;
      yielding.abort();

      return true;
    },
    get messages() {
      return messages;
    },
    get running() {
      return running;
    },
    close() {
      // Every call waits for the same cleanup: a second close() never resolves before it's done.
      closed ??= (async () => {
        closing.abort();
        await tasks.cancelAll();

        const session = sessions.get(mainSession.id);

        sessions.end({
          id: mainSession.id,
          state: session?.state === 'idle' ? (session.lastOutcome ?? 'completed') : 'interrupted',
        });
      })();

      return closed;
    },
  };
}
