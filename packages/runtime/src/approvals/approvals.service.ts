/**
 * Approvals: a tool that needs the user's say (`request`) waits here, while subscribers (a UI)
 * hear about it through typed updates. These don't go through the loop's event stream: a tool
 * result waiting there would hold back the request it waits for. A UI answers with `respond`,
 * and the waiting tool carries on. The harness renders nothing.
 */
import { ApprovalListenerError, ApprovalRequestError } from '../errors/approvals.errors.js';
import { redactDiagnosticText } from '@sheavly/core/text/diagnostic-text.utils';
import { errorMessage } from '../errors/errors.utils.js';
import { DEFAULT_OPTIONS, HOOK_DECISIONS } from './approvals.constants.js';
import type { Screener } from './approvals.types.js';
import type {
  ApprovalConcern,
  ApprovalId,
  ApprovalOption,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalUpdate,
} from '@sheavly/protocol/approval/approval.types';
import {
  approvalIdSchema,
  approvalResponseOfferedBy,
  approvalResponseSchema,
} from '@sheavly/protocol/approval/approval.validator';
import type { CallId } from '@sheavly/protocol/message/message.types';
import type { AllowEntry } from '@sheavly/protocol/permission/permission.types';
import type { SessionId } from '@sheavly/protocol/session/session.types';

/** The answer that stops a command and tells the model why. */
function skippedBy(message: string): ApprovalResponse {
  return { decision: 'skip_with_message', message, source: 'hook' };
}

/** An answer without its `source`: what a UI's answer is, whatever it sent. */
function withoutSource(answer: ApprovalResponse): ApprovalResponse {
  if (answer.decision === 'skip') return { decision: 'skip' };

  if (answer.decision === 'skip_with_message') {
    return { decision: 'skip_with_message', message: answer.message };
  }

  return answer;
}

/** A hook's answer, with a skip marked as the hook's so the model is not told the user said it. */
function fromHook(answer: ApprovalResponse): ApprovalResponse {
  if (answer.decision === 'skip' || answer.decision === 'skip_with_message') {
    return { ...answer, source: 'hook' };
  }

  return answer;
}

type Listener = (update: ApprovalUpdate) => void;
type Pending = { request: ApprovalRequest; resolve: (response: ApprovalResponse) => void };

export class ApprovalRegistry {
  #pending = new Map<ApprovalId, Pending>();
  #screeners = new Set<Screener>();
  #listeners = new Set<Listener>();
  /** Record updates (the combined stream) but can't answer, so they never make `listening` true. */
  #observers = new Set<Listener>();
  /** Updates waiting to be heard, while an earlier one is still being delivered. */
  #queue: ApprovalUpdate[] = [];
  #emitting = false;
  #nextId = 1;

  /** True while someone subscribes, i.e. a request can be answered at all. */
  get listening(): boolean {
    return this.#listeners.size > 0;
  }

  /**
   * Announces a request and waits for its answer. Rejects if `signal` aborts first (and tells
   * subscribers it was cancelled), or right away if no one is listening. `options` is what the
   * user may answer (run, skip, skip with a message unless the caller offers more); `respond`
   * refuses any other.
   */
  request(params: {
    callId: CallId;
    sessionId?: SessionId | undefined;
    tool: string;
    command: string;
    concerns: ApprovalConcern[];
    options?: readonly ApprovalOption[];
    /** What `always_allow` would keep, when `options` offers it (see `ApprovalRequest.keeps`). */
    keeps?: readonly AllowEntry[];
    signal: AbortSignal;
  }): Promise<ApprovalResponse> {
    const { signal, sessionId, options = DEFAULT_OPTIONS, ...rest } = params;

    if (signal.aborted) return Promise.reject(signal.reason as Error);

    const request: ApprovalRequest = {
      id: approvalIdSchema.parse(`a${this.#nextId++}`),
      ...rest,
      ...(sessionId !== undefined && { sessionId }),
      options,
    };

    // Without screeners the request is announced in this call, as before: waiting a microtask
    // would change when a UI hears of it.
    if (this.#screeners.size === 0) return this.#ask(request, signal);

    return this.#screen({ request, signal }).then((answer) => answer ?? this.#ask(request, signal));
  }

  /**
   * Registers a screener for every request from now on, ahead of any UI: a hook that settles or
   * stops a command before the user is asked. Returns a function that removes it.
   */
  screen(screener: Screener): () => void {
    this.#screeners.add(screener);

    return () => {
      this.#screeners.delete(screener);
    };
  }

  /**
   * Asks the screeners in registration order; the first to answer settles the request, and a UI
   * never hears of it. Fails closed: a screener that throws, or answers with something the
   * request did not offer, skips the command with the reason, so a broken guard never lets one
   * through. An abort rejects like any other wait.
   */
  async #screen(params: {
    request: ApprovalRequest;
    signal: AbortSignal;
  }): Promise<ApprovalResponse | undefined> {
    const { request, signal } = params;

    for (const screener of this.#screeners) {
      let answer: unknown;

      try {
        answer = await screener({ request, signal });
      } catch (caughtError) {
        if (signal.aborted) throw signal.reason as Error;

        return skippedBy(
          `An approval hook failed: ${redactDiagnosticText(errorMessage(caughtError))}`,
        );
      }

      if (answer === undefined) continue;

      const parsed = approvalResponseSchema.safeParse(answer);

      // A hook may only stop the command: approving, once or for good, is the user's to give, so a
      // repo's hook can neither run something the user was asking about nor persist a grant.
      if (
        parsed.success &&
        HOOK_DECISIONS.includes(parsed.data.decision) &&
        request.options.includes(parsed.data.decision)
      ) {
        return fromHook(parsed.data);
      }

      return skippedBy('An approval hook gave an answer it may not give here');
    }

    return undefined;
  }

  /** Announces a request to the UIs and waits for the answer. */
  #ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalResponse> {
    // A screener can take time, and an abort during it fires no event later: an already-aborted
    // signal would never reject the wait below, so the request would sit in the UI forever.
    if (signal.aborted) return Promise.reject(signal.reason as Error);

    if (!this.listening) {
      return Promise.reject(
        new ApprovalRequestError({
          reason: 'no_listener',
          message: 'No one is listening for approvals',
        }),
      );
    }

    return new Promise<ApprovalResponse>((resolve, reject) => {
      // Called from the abort event, so a listener failure can't be thrown: the call fails
      // with it instead of the abort reason (it was stopped either way).
      const onAbort = () => {
        this.#pending.delete(request.id);

        try {
          this.#emit({ type: 'approval_cancelled', id: request.id });
          reject(signal.reason as Error);
        } catch (caughtError) {
          if (!(caughtError instanceof ApprovalListenerError)) throw caughtError;
          reject(caughtError);
        }
      };

      this.#pending.set(request.id, {
        request,
        resolve: (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });

      // A listener that can't hear the request: nobody can answer it reliably, so the call
      // fails closed (the command doesn't run) instead of waiting.
      try {
        this.#emit({ type: 'approval_requested', request });
      } catch (caughtError) {
        if (!(caughtError instanceof ApprovalListenerError)) throw caughtError;
        this.#pending.delete(request.id);
        signal.removeEventListener('abort', onAbort);
        reject(caughtError);
      }
    });
  }

  /** Answers a waiting request. Throws for an unknown (or already answered) id or a bad answer. */
  respond(params: { id: ApprovalId; response: unknown }): void {
    const { id } = params;
    const pending = this.#pending.get(id);

    if (!pending) {
      throw new ApprovalRequestError({
        reason: 'unknown_id',
        message: `No approval is waiting with id ${id}`,
      });
    }

    // Only the registry marks an answer as a hook's: a client's `source` is dropped, so a UI
    // cannot make the model read the user's words as a hook's.
    const response = withoutSource(approvalResponseSchema.parse(params.response));

    // One rule for "offered": the schema a client or server can validate against too.
    if (!approvalResponseOfferedBy(pending.request.options).safeParse(response).success) {
      throw new ApprovalRequestError({
        reason: 'not_offered',
        message: `${response.decision} is not one of the options offered for approval ${id}: ${pending.request.options.join(', ')}`,
      });
    }

    this.#pending.delete(id);
    pending.resolve(response);
    this.#emit({ type: 'approval_resolved', id, response });
  }

  /** Requests still waiting, oldest first (so a late UI can catch up). */
  pending(): ApprovalRequest[] {
    return [...this.#pending.values()].map(({ request }) => request);
  }

  /**
   * Calls `observer` for every update from now on, before the listeners, without counting as
   * someone who can answer: with only observers, a request still fails closed (`no_listener`).
   * For a record of approvals, such as the combined stream. Returns a function that stops it.
   */
  observe(observer: Listener): () => void {
    this.#observers.add(observer);

    return () => {
      this.#observers.delete(observer);
    };
  }

  /** Calls `listener` for every update from now on. Returns a function that stops it. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Every listener hears every update, in order: one sent while listeners are still hearing
   * another (a listener calling `respond` from `approval_requested`) waits until all of them have
   * heard the first. A listener that throws never stops the others or the queue: every update is
   * still delivered, then the first failure is thrown to whoever sent it, as an
   * `ApprovalListenerError` (a UI bug is reported, never hidden).
   */
  #emit(update: ApprovalUpdate): void {
    this.#queue.push(update);
    if (this.#emitting) return;
    this.#emitting = true;

    const failures: ApprovalListenerError[] = [];

    try {
      for (let next = this.#queue.shift(); next; next = this.#queue.shift()) {
        failures.push(...this.#deliver(next));
      }
    } finally {
      this.#emitting = false;
    }

    if (failures[0]) throw failures[0];
  }

  /** One update to every listener; returns the failures of those that threw. */
  #deliver(update: ApprovalUpdate): ApprovalListenerError[] {
    const failures: ApprovalListenerError[] = [];

    for (const listener of [...this.#observers, ...this.#listeners]) {
      try {
        listener(update);
      } catch (caughtError) {
        failures.push(new ApprovalListenerError({ update: update.type, cause: caughtError }));
      }
    }

    return failures;
  }
}
