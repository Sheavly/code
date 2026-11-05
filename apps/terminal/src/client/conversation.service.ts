import { createClient } from '@sheavly/client/client/client.helper';
import { readEntries } from '@sheavly/client/client/entries.helper';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type {
  ApprovalId,
  ApprovalResponse,
  ApprovalUpdate,
} from '@sheavly/protocol/approval/approval.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type { ConversationDetails, ConversationId } from '@sheavly/protocol/server/server.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { Backend } from './client.types.js';

type Client = ReturnType<typeof createClient>;

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
    messages?: Message[];
  }): Promise<RemoteConversation> {
    const { backend, messages } = params;
    const client = createClient({
      url: backend.url,
      token: backend.token,
      ...(backend.fetch && { fetch: backend.fetch }),
    });
    const { id } = await client.call('startConversation', { body: messages ? { messages } : {} });

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
  async messages(): Promise<Message[]> {
    return (await this.#client.call('getMessages', { id: this.id })).messages;
  }

  /** Switches to the model with this id, from the next model call; false when the conversation hasn't it. */
  async useModel(modelId: ModelId): Promise<boolean> {
    try {
      await this.#client.send('switchModel', { id: this.id, body: { id: modelId } });
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
        this.#countTask(entry);
        yield entry;
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
  async watchApprovals(params: {
    onUpdate: (update: ApprovalUpdate) => void;
    signal: AbortSignal;
  }): Promise<{ ended: Promise<void> }> {
    const { onUpdate, signal } = params;
    const body = await this.#client.open('streamConversation', {
      id: this.id,
      body: { approvals: true },
      signal,
    });

    const follow = async (): Promise<void> => {
      try {
        for await (const { entry } of readEntries(body)) {
          if (entry.kind === 'approval') onUpdate(entry.update);
        }
      } catch (caughtError) {
        // Stopping the watch is how it ends; anything else is a real failure.
        if (!signal.aborted) throw caughtError;
      }
    };

    return { ended: follow() };
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
