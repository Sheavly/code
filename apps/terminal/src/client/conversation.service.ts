import { createServerClient } from '@sheavly/server/client/client.helper';
import { readEntries } from '@sheavly/server/client/entries.helper';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { ConversationDetails, ConversationId } from '@sheavly/protocol/server/server.types';
import { messagesResponseSchema } from '@sheavly/protocol/server/server.validator';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { BackendError } from '../errors/backend.errors.js';
import type { Backend } from './client.types.js';
import { parseServerError } from './client.validator.js';

type Client = ReturnType<typeof createServerClient>;

/**
 * One conversation on a backend, as the terminal drives it: started (or continued from saved
 * `messages`) on `open`, then prompts sent and their entries read, over HTTP only. It counts the
 * background tasks still running from the task entries it reads, for the renderer to show.
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
    const started = await ok(client.conversations.$post({ json: messages ? { messages } : {} }));

    return new RemoteConversation(client, (await started.json()).id);
  }

  /** How many background tasks the entries read so far say still run. */
  get runningTasks(): number {
    return this.#running.size;
  }

  async details(): Promise<ConversationDetails> {
    return (await ok(this.#client.conversations[':id'].$get({ param: { id: this.id } }))).json();
  }

  async skills(): Promise<SkillInfo[]> {
    const response = await this.#client.conversations[':id'].skills.$get({
      param: { id: this.id },
    });

    return (await (await ok(response)).json()).skills;
  }

  /** The history so far, checked against the protocol: it is saved, and continued from. */
  async messages(): Promise<Message[]> {
    const response = await this.#client.conversations[':id'].messages.$get({
      param: { id: this.id },
    });

    return messagesResponseSchema.parse(await (await ok(response)).json()).messages;
  }

  /** Switches to model `name`, from the next model call; false when the conversation hasn't it. */
  async useModel(name: string): Promise<boolean> {
    try {
      await ok(
        this.#client.conversations[':id'].model.$put({ param: { id: this.id }, json: { name } }),
      );
    } catch (caughtError) {
      // Only "no such model" is the user's to fix with another name; anything else is a failure.
      if (caughtError instanceof BackendError && caughtError.code === 'unknown_model') return false;
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
    const response = await ok(
      this.#client.conversations[':id'].prompts.$post({ param: { id: this.id }, json: { text } }),
    );
    const stop = () =>
      void this.#client.conversations[':id'].stop.$post({ param: { id: this.id } });

    signal?.addEventListener('abort', stop, { once: true });

    try {
      for await (const { entry } of readEntries(response.body)) {
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
  async rawStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await ok(
      this.#client.conversations[':id'].stream.$query(
        { param: { id: this.id }, json: { replay: true } },
        { init: { signal } },
      ),
    );

    if (!response.body) throw new BackendError({ message: 'The stream came back without a body' });

    return response.body;
  }

  /** Closes it on the backend: its prompts, background tasks and processes stop. */
  async close(): Promise<void> {
    await ok(this.#client.conversations[':id'].$delete({ param: { id: this.id } }));
  }

  #countTask(entry: StreamEntry): void {
    if (entry.kind !== 'task') return;
    if (entry.update.type === 'task_started') this.#running.add(entry.update.task.id);
    else this.#running.delete(entry.update.task.id);
  }
}

/**
 * `response` once it succeeded; a refused one throws a `BackendError` with the server's code and
 * message (the status alone when its body isn't a server error).
 */
async function ok<T extends { ok: boolean; status: number; text: () => Promise<string> }>(
  response: T | Promise<T>,
): Promise<T> {
  const settled = await response;

  if (settled.ok) return settled;

  const refused = parseServerError(await settled.text());

  throw new BackendError({
    message: refused?.error.message ?? `The backend answered ${String(settled.status)}`,
    ...(refused && { code: refused.error.code }),
  });
}
