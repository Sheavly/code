import { now } from '@sheavly/core/clock/clock.helper';
import { randomUUID } from 'node:crypto';
import { messageIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionError } from '@sheavly/runtime/errors/sessions.errors';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { MAX_CONSECUTIVE_WAKES, WAKE_AFTER_YIELD_MS } from './conversation.constants.js';
import type { Conversation, ConversationOptions } from './conversation.types.js';

/**
 * A conversation on the harness's main session. Every prompt runs `options.run` (the loop's
 * `streamAgent`) on the history so far with `keepSession`, so the session goes idle between
 * prompts instead of ending, and the next prompt resumes it. A prompt ends when the model
 * finishes, even while background work runs; only `await_tasks` holds it. Finite work that
 * finishes while the conversation is idle makes it start a run itself (`wake`) to deliver the
 * notice, at most `maxConsecutiveWakes` in a row without a user prompt; services never wake it.
 * An interrupted prompt leaves history valid to continue from; a failed one keeps the completed
 * work and the user's prompt too.
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
  /** The run `wake` started, until it ends. */
  let waking: Promise<void> | undefined;
  /** Runs `wake` started since the user's last prompt. */
  let wakesInRow = 0;
  const maxWakes = options.maxConsecutiveWakes ?? MAX_CONSECUTIVE_WAKES;
  /** Set by a stop, cleared by the next prompt: no run starts itself meanwhile. */
  let wakesSuppressed = false;
  /** The pending wake after a yielded run, until it fires or a prompt, stop or close drops it. */
  let yieldWake: ReturnType<typeof setTimeout> | undefined;

  function cancelYieldWake(): void {
    clearTimeout(yieldWake);
    yieldWake = undefined;
  }

  /** Stops the running prompt or wake, whoever iterates it. */
  let stopRun: (() => void) | undefined;
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
    /** The user's prompt; none for a wake, which continues from the history with a notice. */
    user: Message | undefined;
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
    const startingMessages = user ? [...messages, user] : [...messages];

    runSignal = signal;
    stopRun = () => stop.abort();
    // The longest history handed to `keepHistory` so far: it only grows, so if the run ends before
    // `done` or `onError` gave us one (it failed before its first turn), this is the truth, and
    // it holds the prompt that was already recorded.
    let latest: readonly HistoryMessage[] = startingMessages;
    const events = run({
      provider,
      tools,
      // The user's hooks, unchanged: a failed run's history comes from its `done` event.
      hooks,
      approvals: harness.approvals,
      messages: startingMessages,
      signal,
      tasks,
      session: { registry: sessions, ref: mainSession },
      keepSession: true,
      // Only `await_tasks` holds the main session open; other finished work wakes it (`wake`).
      holdOpenFor: 'awaited',
      keepHistory: (kept) => {
        latest = kept;
        options.keepHistory?.(kept);
      },
      yieldSignal: params.yieldSignal,
      resumed: params.resumed,
      instructions: options.instructions ?? harness.instructions,
      ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
      ...(options.summary && { summary: options.summary }),
    })[Symbol.asyncIterator]();
    let completed = false;
    const record = (event: AgentEvent) => {
      if (event.type !== 'done') return;
      messages = event.messages;
      completed = event.reason === 'completed';
    };
    let finished = false;

    // The user's prompt is recorded before the run, so a crash mid-run does not lose it.
    if (user) options.keepHistory?.(startingMessages);

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
      stopRun = undefined;

      if (messages.length < latest.length) messages = [...latest];

      // Provider failures do not undo tool effects, so their completed work must stay in history.
      options.keepHistory?.(messages);

      // Work that finished as this run ended found it still running: its notice is waiting now.
      // Only after a run that completed: a stopped or failed one must not restart itself (its
      // cancelled work leaves notices behind). A yielded run gives the line the user queued
      // behind it a moment to arrive as the next prompt, then wakes if none did.
      // No `return` here: it would swallow the error of a run that threw.
      if (finished && completed && params.yieldSignal.aborted) {
        yieldWake = setTimeout(wake, WAKE_AFTER_YIELD_MS);
        yieldWake.unref();
      } else if (finished && completed) {
        wake();
      }
    }
  }

  /**
   * Continues the idle main session when finite work has finished: starts a run on the history
   * with no new prompt, and the loop delivers the notice before its first model call. The run's
   * events reach every UI through the combined stream, since no caller iterates them here. Does
   * nothing while a prompt runs (its own loop delivers), before the first prompt, or once closed.
   */
  function wake(): void {
    if (closed || running || !started || closing.signal.aborted || wakesSuppressed) return;
    if (wakesInRow >= maxWakes) return;

    try {
      if (!tasks.hasWakingDeliveries(mainSession.id)) return;
      sessions.resume(mainSession.id);
      wakesInRow++;
      running = true;
      yielding = new AbortController();
      runSignal = closing.signal;
      const woken = drain(
        prompt({ user: undefined, resumed: true, signal: runSignal, yieldSignal: yielding.signal }),
      ).finally(() => {
        if (waking === woken) waking = undefined;
      });

      waking = woken;
    } catch (caughtError) {
      // Nothing awaits a wake, so a refusal (an ended session) goes to the app, not the process.
      running = false;
      options.onWakeFailure?.(caughtError);
    }
  }

  /**
   * Asks a running wake to end at its completion point and waits for it, so a prompt can start.
   * The ended wake is a yielded run: it wakes again after a short grace only if no prompt came.
   */
  async function settleWake(): Promise<void> {
    if (!waking) return;
    yielding.abort();
    await waking;
  }

  /**
   * Runs a prompt nobody iterates to its end. UIs already see a failure in the stream
   * (`run_failed`); there is no caller to throw to, so the app is told through `onWakeFailure`.
   */
  async function drain(events: AsyncIterable<AgentEvent>): Promise<void> {
    try {
      for await (const _event of events);
    } catch (caughtError) {
      options.onWakeFailure?.(caughtError);
    }
  }

  /** Every settlement may have made a notice ready for an idle session. */
  async function wakeOnSettled(): Promise<void> {
    while (!closing.signal.aborted) {
      await tasks.nextSettled(closing.signal);
      wake();
    }
  }

  void wakeOnSettled();

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
      wakesInRow = 0;
      wakesSuppressed = false;
      cancelYieldWake();
      // A caller aborting its own prompt is a stop too, whoever calls it. A signal already
      // aborted (a stop during preparation) never fires its listener, so it is checked here.
      if (sendOptions.signal?.aborted) wakesSuppressed = true;
      sendOptions.signal?.addEventListener('abort', () => (wakesSuppressed = true), { once: true });
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
        origin: 'user',
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
    settleWake,
    stop() {
      // The user stopped this, running or not: finished work waits for their next prompt instead
      // of restarting it.
      wakesSuppressed = true;
      cancelYieldWake();

      if (!running || !stopRun) return false;
      stopRun();

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
        cancelYieldWake();
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
