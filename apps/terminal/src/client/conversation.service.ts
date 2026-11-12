import { watchApprovals } from '@sheavly/client/approvals/approvals.helper';
import type { HeardApproval } from '@sheavly/client/approvals/approvals.types';
import { createClient } from '@sheavly/client/client/client.helper';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { ApprovalId, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import type { ClientHistoryMessage, HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ModelId, ModelMode } from '@sheavly/protocol/model/model.types';
import type { ConversationDetails, ConversationId } from '@sheavly/protocol/server/server.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { Backend } from './client.types.js';
import { BackendError } from '../errors/backend.errors.js';

type Client = ReturnType<typeof createClient>;

function clientFor(backend: Backend): Client {
  return createClient({
    url: backend.url,
    token: backend.token,
    ...(backend.fetch && { fetch: backend.fetch }),
  });
}

/**
 * One conversation on a backend, as the terminal drives it: started (or continued from saved
 * `messages`) on `open`, then prompts sent and their entries read, over HTTP only, through the
 * client built from the API's routes. It counts the background tasks still running from the task
 * entries it reads, for the renderer to show. A refused request throws `RefusedError`.
 */
export class RemoteConversation {
  readonly #client: Client;
  readonly #running = new Set<string>();

  private constructor(
    client: Client,
    readonly id: ConversationId,
  ) {
    this.#client = client;
  }

  /** Starts a conversation on `backend`, empty or continuing `messages`. */
  static async open(params: {
    backend: Backend;
    messages?: ClientHistoryMessage[];
    workspace?: string;
    /** The model to start on, by id or name; the profile's own choice when omitted. */
    model?: string | undefined;
  }): Promise<RemoteConversation> {
    const { backend, messages, workspace, model } = params;
    const client = clientFor(backend);
    const { id } = await client.call('startConversation', {
      body: {
        ...(messages && { messages }),
        ...(workspace && { workspace }),
        ...(model && { model }),
      },
    });

    return new RemoteConversation(client, id);
  }

  /** Reopens a saved conversation under its original id, history, workspace and model selection. */
  static async reopen(params: {
    backend: Backend;
    id: ConversationId;
  }): Promise<RemoteConversation> {
    const client = clientFor(params.backend);
    const { id } = await client.call('reopenConversation', { id: params.id });

    return new RemoteConversation(client, id);
  }

  /** How many background tasks the entries read so far say still run. */
  get runningTasks(): number {
    return this.#running.size;
  }

  details(): Promise<ConversationDetails> {
    return this.#client.call('getConversation', { id: this.id });
  }

  /** The skills a prompt can run, all or those `search` matches (name or description). */
  async skills(search?: string): Promise<SkillInfo[]> {
    const body = search ? { search } : {};

    return (await this.#client.call('querySkills', { id: this.id, body })).skills;
  }

  /** The history so far: it is saved, and continued from. */
  async messages(): Promise<HistoryMessage[]> {
    return (await this.#client.call('getMessages', { id: this.id })).messages;
  }

  /** Switches to the model with this id, from the next model call; false when the conversation hasn't it. */
  async useModel(modelId: ModelId, mode?: ModelMode): Promise<boolean> {
    try {
      await this.#client.send('switchModel', {
        id: this.id,
        body: { id: modelId, ...(mode && { mode }) },
      });
    } catch (caughtError) {
      // Only "no such model" is the user's to fix with another model; anything else is a failure.
      if (caughtError instanceof RefusedError && caughtError.code === 'unknown_model') {
        return false;
      }

      throw caughtError;
    }

    return true;
  }

  /**
   * Asks the active prompt to end at its completion point instead of waiting for background
   * work, so the caller can send the next prompt. Nothing is interrupted or delivered to it.
   * False means no prompt is running or it is already stopping. Aborting `signal` gives up
   * waiting for the answer, not the request's effect if the backend already got it.
   */
  async yieldPrompt(signal?: AbortSignal): Promise<boolean> {
    return (await this.#client.call('yieldPrompt', { id: this.id, ...(signal && { signal }) }))
      .accepted;
  }

  /**
   * Sends `text` and yields its entries, every session's, to the main session's `done`. Aborting
   * `signal` stops the prompt on the backend; its entries still come, ending with that `done`.
   */
  async *send(params: { text: string; signal?: AbortSignal }): AsyncGenerator<StreamEntry> {
    const { text, signal } = params;
    const stop = () => void this.#client.send('stopPrompt', { id: this.id });

    signal?.addEventListener('abort', stop, { once: true });

    try {
      for await (const entry of this.#client.stream('sendPrompt', {
        id: this.id,
        body: { text },
      })) {
        if (
          entry.kind === 'event' &&
          entry.event.type === 'run_failed' &&
          entry.event.session.depth === 1
        ) {
          const error = entry.messageId
            ? `[message ${entry.messageId}] ${entry.event.error}`
            : entry.event.error;

          throw new BackendError({ message: error });
        }

        this.#countTask(entry);
        yield entry;

        if (
          entry.kind === 'update' &&
          entry.update.type === 'session_idle' &&
          entry.update.session.depth === 1 &&
          entry.update.session.lastOutcome === 'failed'
        ) {
          throw new BackendError({
            message:
              'The model run failed before completing. The backend log contains the original error.',
          });
        }
      }
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /**
   * The conversation's whole stream, from its start, as raw SSE: what a UI reads, for a run to
   * save. It ends when `signal` aborts.
   */
  rawStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return this.#client.open('streamConversation', { id: this.id, body: { replay: true }, signal });
  }

  /**
   * Answers the conversation's approvals: while the returned `ended` runs, a command that needs
   * one waits for the user instead of being refused at once, and `onUpdate` hears each approval
   * asked, and each one answered or given up on (by this UI, another, or an interrupt).
   *
   * Resolves once the backend has accepted the stream, which is when it counts: an approval asked
   * before that is refused on the spot, so send the first prompt only after this resolves. `ended`
   * resolves when `signal` aborts or the stream ends, and rejects on any other failure.
   */
  watchApprovals(params: {
    onApproval: (heard: HeardApproval) => void;
    /** Usage from every session also arrives between prompts, while background agents finish. */
    onUsage?: (entry: StreamEntry) => void;
    signal: AbortSignal;
  }): Promise<{ ended: Promise<void> }> {
    const { onApproval, onUsage, signal } = params;

    return watchApprovals({
      client: this.#client,
      id: this.id,
      onApproval,
      onEntry: (entry) => {
        if (entry.kind === 'event' && entry.event.type === 'usage') onUsage?.(entry);
      },
      signal,
    });
  }

  /** Answers a waiting approval. `unknown_approval` when it is gone: someone answered first. */
  answerApproval(params: { approval: ApprovalId; response: ApprovalResponse }): Promise<void> {
    return this.#client.send('answerApproval', {
      id: this.id,
      approval: params.approval,
      body: { response: params.response },
    });
  }

  /** Closes it on the backend: its prompts, background tasks and processes stop. */
  close(): Promise<void> {
    return this.#client.send('closeConversation', { id: this.id });
  }

  // A task that ends between prompts sends its `task_ended` to no prompt's stream; the loop tells
  // the next prompt with `task_completed` instead, so that counts as its end too.
  #countTask(entry: StreamEntry): void {
    if (entry.kind === 'event' && entry.event.type === 'task_completed') {
      this.#running.delete(entry.event.task.id);

      return;
    }

    if (entry.kind !== 'task') return;
    if (entry.update.type === 'task_started') this.#running.add(entry.update.task.id);
    else this.#running.delete(entry.update.task.id);
  }
}
