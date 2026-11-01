/**
 * Approvals: a tool that needs the user's say (`request`) waits here, while subscribers (a UI)
 * hear about it through typed updates. These don't go through the loop's event stream: a tool
 * result waiting there would hold back the request it waits for. A UI answers with `respond`,
 * and the waiting tool carries on. The harness renders nothing.
 */
import type {
  ApprovalConcern,
  ApprovalOption,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalUpdate,
} from './approvals.types.js';
import { approvalResponseSchema } from './approvals.utils.js';

type Listener = (update: ApprovalUpdate) => void;
type Pending = { request: ApprovalRequest; resolve: (response: ApprovalResponse) => void };

const OPTIONS: readonly ApprovalOption[] = ['approve', 'skip', 'skip_with_message'];

export class ApprovalRegistry {
  #pending = new Map<string, Pending>();
  #listeners = new Set<Listener>();
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
   * subscribers it was cancelled), or right away if no one is listening.
   */
  request(params: {
    callId: string;
    sessionId?: string | undefined;
    tool: string;
    command: string;
    concerns: ApprovalConcern[];
    signal: AbortSignal;
  }): Promise<ApprovalResponse> {
    const { signal, sessionId, ...rest } = params;

    if (!this.listening) return Promise.reject(new Error('No one is listening for approvals'));
    if (signal.aborted) return Promise.reject(signal.reason as Error);

    const request: ApprovalRequest = {
      id: `a${this.#nextId++}`,
      ...rest,
      ...(sessionId !== undefined && { sessionId }),
      options: OPTIONS,
    };

    return new Promise<ApprovalResponse>((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(request.id);
        reject(signal.reason as Error); // settle first: a listener can't keep the call waiting
        this.#emit({ type: 'approval_cancelled', id: request.id });
      };

      this.#pending.set(request.id, {
        request,
        resolve: (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      this.#emit({ type: 'approval_requested', request });
    });
  }

  /** Answers a waiting request. Throws for an unknown (or already answered) id or a bad answer. */
  respond(params: { id: string; response: unknown }): void {
    const { id } = params;
    const pending = this.#pending.get(id);

    if (!pending) throw new Error(`No approval is waiting with id ${id}`);

    const response = approvalResponseSchema.parse(params.response);

    this.#pending.delete(id);
    pending.resolve(response);
    this.#emit({ type: 'approval_resolved', id, response });
  }

  /** Requests still waiting, oldest first (so a late UI can catch up). */
  pending(): ApprovalRequest[] {
    return [...this.#pending.values()].map(({ request }) => request);
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
   * heard the first. A listener that throws is skipped, never allowed to stop the others or the
   * request: a UI bug can't hang a tool call or lose an answer.
   */
  #emit(update: ApprovalUpdate): void {
    this.#queue.push(update);
    if (this.#emitting) return;
    this.#emitting = true;

    try {
      for (let next = this.#queue.shift(); next; next = this.#queue.shift()) this.#deliver(next);
    } finally {
      this.#emitting = false;
    }
  }

  /** One update to every listener; one that throws is skipped. */
  #deliver(update: ApprovalUpdate): void {
    for (const listener of this.#listeners) {
      try {
        listener(update);
      } catch {
        // The listener's own problem; the registry carries on.
      }
    }
  }
}
