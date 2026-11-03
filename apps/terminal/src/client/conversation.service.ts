import { createServerClient } from '@sheavly/server/client/client.helper';
import { ServerRefusedError } from '@sheavly/server/errors/client.errors';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ConversationDetails, ConversationId } from '@sheavly/protocol/server/server.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { Backend } from './client.types.js';

type Client = ReturnType<typeof createServerClient>;

/**
 * One conversation on a backend, as the terminal drives it: started (or continued from saved
 * `messages`) on `open`, then prompts sent and their entries read, over HTTP only, through the
 * client built from the API's routes. It counts the background tasks still running from the task
 * entries it reads, for the renderer to show. A refused request throws `ServerRefusedError`.
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
    const client = createServerClient({
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

  /** Switches to model `name`, from the next model call; false when the conversation hasn't it. */
  async useModel(name: string): Promise<boolean> {
    try {
      await this.#client.send('switchModel', { id: this.id, body: { name } });
    } catch (caughtError) {
      // Only "no such model" is the user's to fix with another name; anything else is a failure.
      if (caughtError instanceof ServerRefusedError && caughtError.code === 'unknown_model') {
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

  /** Closes it on the backend: its prompts, background tasks and processes stop. */
  close(): Promise<void> {
    return this.#client.send('closeConversation', { id: this.id });
  }

  #countTask(entry: StreamEntry): void {
    if (entry.kind !== 'task') return;
    if (entry.update.type === 'task_started') this.#running.add(entry.update.task.id);
    else this.#running.delete(entry.update.task.id);
  }
}
