import { watchApprovals } from '@sheavly/client/approvals/approvals.helper';
import type { HeardApproval } from '@sheavly/client/approvals/approvals.types';
import { createClient } from '@sheavly/client/client/client.helper';
import { readEntries } from '@sheavly/client/client/entries.helper';
import { RefusedError } from '@sheavly/client/errors/client.errors';
import type { ApprovalId, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import type { ClientHistoryMessage, HistoryMessage } from '@sheavly/protocol/history/history.types';
import type { ModelId, ModelMode } from '@sheavly/protocol/model/model.types';
import type { ConversationDetails, ConversationId } from '@sheavly/protocol/server/server.types';
import { isMainSession } from '@sheavly/protocol/session/session.utils';
import { runEnd } from '@sheavly/protocol/status/run-end.utils';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import type { Backend } from './client.types.js';
import { ENDED_TASKS_KEPT } from './client.constants.js';
import { BackendError } from '../errors/backend.errors.js';

type Client = ReturnType<typeof createClient>;

/** The background work still running: commands, sub-agents and services. */
type Background = { tasks: number; agents: number; services: number };

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
 * client built from the API's routes. It keeps the background tasks still running, with their
 * kind, from the task entries it reads, for the status line to show. A refused request throws
 * `RefusedError`.
 */
export class RemoteConversation {
  readonly #client: Client;
  readonly #running = new Map<string, TaskInfo>();
  #onBackground: ((background: Background) => void) | undefined;
  /** Ids of tasks that ended, newest last and capped: a late start for one is ignored. */
  readonly #ended = new Set<string>();

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
    /** The reasoning effort to start on, for this conversation only; the profile's own when omitted. */
    mode?: ModelMode | undefined;
  }): Promise<RemoteConversation> {
    const { backend, messages, workspace, model, mode } = params;
    const client = clientFor(backend);
    const { id } = await client.call('startConversation', {
      body: {
        ...(messages && { messages }),
        ...(workspace && { workspace }),
        ...(model && { model }),
        ...(mode && { mode }),
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

  /**
   * The background work the entries read so far say still runs: sub-agents, services, and
   * everything else (a plain task).
   */
  get background(): Background {
    const kinds = [...this.#running.values()].map(({ kind }) => kind);
    const agents = kinds.filter((kind) => kind === 'agent').length;
    const services = kinds.filter((kind) => kind === 'service').length;

    return { tasks: kinds.length - agents - services, agents, services };
  }

  /**
   * Tells `listener` the background work now, then whenever it changes. There is one listener: a
   * later call replaces it.
   */
  watchBackground(listener: (background: Background) => void): void {
    this.#onBackground = listener;
    listener(this.background);
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

  /** The lines kept as queued behind a prompt, oldest first: pending input, outside the history. */
  async queue(): Promise<string[]> {
    return (await this.#client.call('getQueue', { id: this.id })).queued;
  }

  /** Keeps `queued` as the conversation's pending lines, replacing what was kept. */
  setQueue(queued: readonly string[]): Promise<void> {
    return this.#client.send('setQueue', { id: this.id, body: { queued: [...queued] } });
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
          isMainSession(entry.event.session)
        ) {
          const error = entry.messageId
            ? `[message ${entry.messageId}] ${entry.event.error}`
            : entry.event.error;

          throw new BackendError({ message: error });
        }

        this.#countTask(entry);
        yield entry;

        if (runEnd(entry) === 'failed') {
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

  /** Stops whatever the conversation runs now, a prompt or a run it started itself. */
  stop(): Promise<void> {
    return this.#client.send('stopPrompt', { id: this.id });
  }

  /**
   * Follows the conversation's live stream, every session's entries from now on, so a UI shows
   * what a run the backend starts itself does (it wakes the idle conversation when background work
   * finishes). Entries a prompt's own stream carries arrive here too: the caller shows each once.
   * Resolves once the backend accepted the stream; `ended` resolves when `signal` aborts and
   * rejects on any other end, including the backend closing the stream.
   */
  async follow(params: {
    onEntry: (entry: StreamEntry) => void;
    signal: AbortSignal;
  }): Promise<{ ended: Promise<void> }> {
    const { onEntry, signal } = params;
    const body = await this.#client.open('streamConversation', { id: this.id, body: {}, signal });
    const ended = (async () => {
      try {
        for await (const { entry } of readEntries(body)) {
          this.#countTask(entry);
          onEntry(entry);
        }

        if (!signal.aborted) throw new BackendError({ message: 'The live stream was closed' });
      } catch (caughtError) {
        if (!signal.aborted) throw caughtError;
      }
    })();

    return { ended };
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

  // A task is running or ended, and ended is final. The prompt's stream and the live feed both
  // carry its entries and are not ordered against each other, so a start that arrives after the
  // end must not bring the task back; the same entry twice changes nothing. Ids are unique within
  // one backend registry, which one `RemoteConversation` follows for its whole life.
  #countTask(entry: StreamEntry): void {
    const change = taskChange(entry);

    if (!change) return;

    const { task, running } = change;
    const wasRunning = this.#running.has(task.id);

    if (running && (wasRunning || this.#ended.has(task.id))) return;

    if (!running && !wasRunning) {
      this.#keepEnded(task.id);

      return;
    }

    if (running) {
      this.#running.set(task.id, task);
    } else {
      this.#running.delete(task.id);
      this.#keepEnded(task.id);
    }

    this.#onBackground?.(this.background);
  }

  /** Remembers an ended id, forgetting the oldest past the cap so a long chat does not grow. */
  #keepEnded(id: string): void {
    this.#ended.delete(id);
    this.#ended.add(id);

    const oldest = this.#ended.values().next();

    if (this.#ended.size > ENDED_TASKS_KEPT && !oldest.done) this.#ended.delete(oldest.value);
  }
}

/**
 * The task an entry starts or ends, as the status line counts it; undefined for any other entry.
 * A task that ends between prompts sends its `task_ended` to no prompt's stream; the loop tells
 * the next prompt with `task_completed` instead, so that is its end too.
 */
function taskChange(entry: StreamEntry): { task: TaskInfo; running: boolean } | undefined {
  if (entry.kind === 'event' && entry.event.type === 'task_completed') {
    return { task: entry.event.task, running: false };
  }

  if (entry.kind !== 'task') return undefined;

  return { task: entry.update.task, running: entry.update.type === 'task_started' };
}
