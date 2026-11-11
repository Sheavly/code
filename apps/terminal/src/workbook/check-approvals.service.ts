import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { HeardApproval } from '@sheavly/client/approvals/approvals.types';
import type { RemoteConversation } from '../client/conversation.service.js';
import { WorkbookCheckError } from './check.errors.js';
import { checkApprovalResponse } from './check-approval.utils.js';

/** Owns only this conversation's watcher; it never writes a permission store. */
export class CheckApprovals {
  readonly #controller = new AbortController();
  readonly #answers = new Set<Promise<void>>();
  readonly #seen = new Set<string>();
  readonly #settled = new Set<string>();
  #error: WorkbookCheckError | undefined;
  readonly #failure: Promise<WorkbookCheckError>;
  #fail!: (error: WorkbookCheckError) => void;
  #ended: Promise<void> | undefined;
  #stopping = false;

  constructor(
    private readonly params: {
      conversation: Pick<RemoteConversation, 'watchApprovals' | 'answerApproval'>;
      approvedCommands: readonly string[];
      verifyWorkspace: () => Promise<void>;
    },
  ) {
    this.#failure = new Promise((resolve) => {
      this.#fail = resolve;
    });
  }

  /** Acceptance precedes the operation. Watcher/answer failures abort the operation and surface. */
  async run<T>(params: {
    operation: (signal: AbortSignal) => Promise<T>;
    signal: AbortSignal;
  }): Promise<T> {
    const abort = () => {
      this.#stopping = true;
      this.#controller.abort();
    };

    params.signal.addEventListener('abort', abort, { once: true });
    if (params.signal.aborted) abort();

    const work = async () => {
      await this.params.verifyWorkspace();
      const { ended } = await this.params.conversation.watchApprovals({
        signal: this.#controller.signal,
        onApproval: (heard) => this.#answer(heard),
      });

      this.#ended = ended.then(
        () => {
          if (!this.#stopping) {
            this.#failed(
              new WorkbookCheckError({ message: 'Check approval stream ended unexpectedly.' }),
            );
          }
        },
        (caughtError: unknown) => this.#failed(caughtError),
      );
      this.#controller.signal.throwIfAborted();

      return params.operation(this.#controller.signal);
    };

    try {
      return await Promise.race([
        work(),
        this.#failure.then((error) => {
          throw error;
        }),
      ]);
    } finally {
      params.signal.removeEventListener('abort', abort);
      await this.stop();
    }
  }

  /** Abort first, then drain the watcher and any responses already in flight. */
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#controller.abort();
    await this.#ended;
    await Promise.all(this.#answers);
    if (this.#error) throw this.#error;
  }

  #failed(cause: unknown): void {
    this.#error ??= new WorkbookCheckError({
      message: `Check approval watcher failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
    this.#fail(this.#error);
    this.#controller.abort();
  }

  #answer({ update }: HeardApproval): void {
    if (update.type !== 'approval_requested') {
      this.#settled.add(update.id);

      return;
    }

    if (this.#seen.has(update.request.id) || this.#settled.has(update.request.id)) return;
    this.#seen.add(update.request.id);

    const answer = this.#sendAnswer(update.request).catch((caughtError: unknown) => {
      // The call may be interrupted or answered elsewhere while workspace verification runs.
      if (caughtError instanceof RefusedError && caughtError.code === 'unknown_approval') return;
      this.#failed(caughtError);
    });

    this.#answers.add(answer);
    void answer.then(() => this.#answers.delete(answer));
  }

  async #sendAnswer(
    request: Extract<HeardApproval['update'], { type: 'approval_requested' }>['request'],
  ): Promise<void> {
    await this.params.verifyWorkspace();
    if (this.#controller.signal.aborted || this.#settled.has(request.id)) return;

    await this.params.conversation.answerApproval({
      approval: request.id,
      response: checkApprovalResponse({ request, approvedCommands: this.params.approvedCommands }),
    });
  }
}
