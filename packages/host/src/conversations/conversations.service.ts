import { randomUUID } from 'node:crypto';
import { now } from '@sheavly/core/clock/clock.helper';
import type { ConversationStore } from '@sheavly/core/store/store.types';
import { ConversationsError } from '../errors/conversations.errors.js';
import { ConversationKeeper } from './keeper.service.js';
import { readStoredConversation } from './stored-conversation.helper.js';
import type {
  ConversationStorage,
  CreateConversation,
  LiveConversation,
  SentPrompt,
} from './conversations.types.js';
import { matchesSearch } from './conversations.utils.js';
import type { ApprovalId, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message, PromptPart } from '@sheavly/protocol/message/message.types';
import type { ModelId } from '@sheavly/protocol/model/model.types';
import type {
  ConversationDetails,
  ConversationId,
  ConversationSummary,
  SendPromptRequest,
} from '@sheavly/protocol/server/server.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';
import type { StoredConversation } from '@sheavly/protocol/store/store.types';

/**
 * The live conversations a host serves, by id: each built by the app's `create`, with the
 * operations a UI calls on them. No transport: an in-process UI calls these directly, and the
 * HTTP server only turns requests into these calls, so both behave the same.
 *
 * Given a `store`, every conversation is kept as it runs (its stream, its history and an index
 * entry), a past one can be listed (`listStored`) and reopened (`reopen`), and one whose storage
 * fails is refused its next prompt rather than carried on unrecorded.
 */
export class Conversations {
  readonly #create: CreateConversation;
  readonly #store: ConversationStore | undefined;
  readonly #live = new Map<ConversationId, LiveConversation>();
  /** Each live conversation's keeper, when the host has a store. */
  readonly #keepers = new Map<ConversationId, ConversationKeeper>();
  /** Each conversation's running prompt's stop switch. */
  readonly #running = new Map<ConversationId, AbortController>();

  constructor(params: { create: CreateConversation; store?: ConversationStore }) {
    this.#create = params.create;
    this.#store = params.store;
  }

  /** Starts a conversation, empty or continuing `messages`, and returns its id. */
  async start(params: { messages?: Message[] | undefined } = {}): Promise<ConversationId> {
    const id = conversationIdSchema.parse(randomUUID());
    const keeper = this.#keeperFor(id);
    const live = await this.#create({
      messages: params.messages,
      ...(keeper && this.#storageOf({ keeper, id })),
    });

    this.#live.set(id, live);
    this.#begin({ id, keeper });

    return id;
  }

  /**
   * Brings a stored conversation back to life under its own id, continuing from its history:
   * its stream carries on from the last stored entry, its sessions are back, and a sub-agent
   * that was running when the process ended is `interrupted`. A conversation that is already
   * live is left as it is. `not_found` when the store has no such conversation (or the host
   * keeps none).
   */
  async reopen(id: ConversationId): Promise<ConversationId> {
    if (this.#live.has(id)) return id;

    if (!this.#store) {
      throw new ConversationsError({
        reason: 'not_found',
        message: `No stored conversation ${id}: this host keeps none`,
      });
    }

    const { stored, messages, resume } = await readStoredConversation({ store: this.#store, id });
    const keeper = this.#keeperFor(id);
    const storage = this.#storageOf({ keeper, id }).storage;
    const live = await this.#create({
      messages,
      ...(storage && { storage: { ...storage, resume } }),
    });

    this.#live.set(id, live);
    keeper?.begin({ ...stored, status: 'open' });
    keeper?.keepHistory(messages);

    return id;
  }

  /**
   * The stored conversations, oldest first, as the store lists them, except that one marked open
   * which no live conversation here owns is `interrupted`: the process that kept it ended.
   */
  async listStored(): Promise<StoredConversation[]> {
    const stored = (await this.#store?.list()) ?? [];

    return stored.map((conversation) =>
      conversation.status === 'open' && !this.#live.has(conversation.id)
        ? { ...conversation, status: 'interrupted' }
        : conversation,
    );
  }

  /** The conversation `id`, or a `not_found` error. */
  get(id: ConversationId): LiveConversation {
    const live = this.#live.get(id);

    if (!live) {
      throw new ConversationsError({
        reason: 'not_found',
        message: `No conversation ${id}: it was closed, or never started`,
      });
    }

    return live;
  }

  /**
   * Every live conversation, oldest first: its main session's title and start, and whether a
   * prompt runs now. For a UI that joins a conversation another UI started.
   */
  list(): ConversationSummary[] {
    return [...this.#live.keys()].map((id) => this.#summary(id));
  }

  /**
   * What conversation `id`'s run is: its summary, and the workspace, models and trust its app
   * reports. `not_found` when no conversation has the id, or its app reports nothing.
   */
  details(id: ConversationId): ConversationDetails {
    const { run } = this.get(id);

    if (!run) {
      throw new ConversationsError({
        reason: 'not_found',
        message: `Conversation ${id} has no details: its app reports none`,
      });
    }

    return { ...this.#summary(id), ...run.details() };
  }

  /**
   * Switches conversation `id` to the model `modelId` from its next model call, or throws
   * `unknown_model`. A kept conversation's index follows, so reopening finds the model last used.
   */
  useModel(params: { id: ConversationId; modelId: ModelId }): void {
    const { id, modelId } = params;

    if (!this.get(id).run?.useModel(modelId)) {
      throw new ConversationsError({
        reason: 'unknown_model',
        message: `No model with id ${modelId} in conversation ${id}; its details list the models`,
      });
    }

    this.#keepers.get(id)?.keepIndex({ modelId });
  }

  #summary(id: ConversationId): ConversationSummary {
    const { harness, conversation } = this.get(id);
    const session = harness.sessions.get(harness.mainSession.id);

    return {
      id,
      title: session?.title ?? '',
      session: harness.mainSession.id,
      running: conversation.running,
      startedAt: session?.startedAt ?? 0,
    };
  }

  /** The keeper of conversation `id`, made on first ask; none when the host keeps nothing. */
  #keeperFor(id: ConversationId): ConversationKeeper | undefined {
    if (!this.#store) return undefined;

    const keeper = this.#keepers.get(id) ?? new ConversationKeeper({ store: this.#store, id });

    this.#keepers.set(id, keeper);

    return keeper;
  }

  /** What the app builds conversation `id` on so it is kept: its stream's store and its history. */
  #storageOf(params: { keeper: ConversationKeeper | undefined; id: ConversationId }): {
    storage?: ConversationStorage;
  } {
    const { keeper, id } = params;

    if (!keeper || !this.#store) return {};

    return {
      storage: {
        entries: this.#store.entries(id),
        keepHistory: (messages) => keeper.keepHistory(messages),
      },
    };
  }

  /** Writes the index entry a new conversation starts with, now that its title and model exist. */
  #begin(params: { id: ConversationId; keeper: ConversationKeeper | undefined }): void {
    const { id, keeper } = params;
    const summary = this.#summary(id);
    const modelId = this.get(id).run?.details().model.id;

    keeper?.begin({
      id,
      title: summary.title,
      ...(modelId !== undefined && { modelId }),
      status: 'open',
      startedAt: summary.startedAt,
      updatedAt: now(),
    });
  }

  /**
   * The failure that stops conversation `id` taking a prompt: its history, index or stream could
   * not be stored. Undefined when storage is fine or the host keeps nothing.
   */
  #storageFailureOf(id: ConversationId) {
    return this.#keepers.get(id)?.failure ?? this.get(id).harness.sessions.storageFailure;
  }

  /**
   * Sends the next prompt: runs the skills it mentions or picks (when the conversation has
   * skills), then starts it. Its events are the caller's to iterate; the combined stream has them
   * too. Throws `session_running` while another runs, `unknown_skill` for a picked skill no one
   * has, and `storage_failed` when the conversation can no longer be kept (it would carry on
   * unrecorded), before anything starts.
   */
  async send(params: {
    id: ConversationId;
    prompt: SendPromptRequest;
    signal?: AbortSignal | undefined;
  }): Promise<SentPrompt> {
    const { id, prompt, signal } = params;
    const { conversation, skills } = this.get(id);
    const failure = this.#storageFailureOf(id);

    if (failure) {
      throw new ConversationsError({
        reason: 'storage_failed',
        message: `Conversation ${id} could not be stored (${failure.message}), so it takes no more prompts rather than carry on unrecorded`,
        cause: failure,
      });
    }

    const prepared = skills
      ? await skills.prepare({ prompt, signal })
      : { text: 'text' in prompt ? prompt.text : textOf(prompt.parts) };

    if ('unknown' in prepared) {
      throw new ConversationsError({
        reason: 'unknown_skill',
        message: `No skill is called ${prepared.unknown.join(', ')}: refresh the skills list`,
      });
    }

    const stop = new AbortController();
    const events = conversation.send(prepared.text, {
      signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
      parts: prepared.parts,
    });

    this.#running.set(id, stop);

    return {
      events: this.#untilDone({ id, stop, events }),
      text: prepared.text,
      ...(prepared.parts && { parts: prepared.parts }),
    };
  }

  /** Stops conversation `id`'s running prompt, if one runs; its history stays valid. */
  stop(id: ConversationId): void {
    this.get(id);
    this.#running.get(id)?.abort();
  }

  /** Answers a waiting approval of conversation `id`; throws for one that isn't waiting. */
  answer(params: { id: ConversationId; approval: ApprovalId; response: ApprovalResponse }): void {
    const { id, approval, response } = params;

    this.get(id).harness.approvals.respond({ id: approval, response });
  }

  /** The history so far, valid to continue from. */
  messages(id: ConversationId): readonly Message[] {
    return this.get(id).conversation.messages;
  }

  /**
   * The skills a prompt in conversation `id` can run, all or those `search` matches (name or
   * description, ignoring case): none when it has no skills.
   */
  async skills(params: {
    id: ConversationId;
    search?: string | undefined;
    signal?: AbortSignal;
  }): Promise<SkillInfo[]> {
    const { id, search, signal } = params;
    const { skills } = this.get(id);

    if (!skills) return [];

    const listed = await skills.list({ ...(signal && { signal }) });

    return search ? listed.filter((skill) => matchesSearch({ skill, search })) : listed;
  }

  /**
   * Closes conversation `id`: stops its prompt, tasks and processes. It is gone after, but a host
   * with a store keeps it as `closed`, to be listed and reopened.
   */
  async close(id: ConversationId): Promise<void> {
    const live = this.get(id);
    const keeper = this.#keepers.get(id);

    this.#live.delete(id);
    this.#running.get(id)?.abort();
    await live.conversation.close();
    await live.dispose?.();
    keeper?.keepIndex({ status: 'closed' });
    await keeper?.flush();
    await live.harness.sessions.flushStore();
    this.#keepers.delete(id);
  }

  /** Closes every conversation: for a host shutting down. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.#live.keys()].map((id) => this.close(id)));
  }

  /** The prompt's events, forgetting its stop switch once it ends, however it ends. */
  async *#untilDone(params: {
    id: ConversationId;
    stop: AbortController;
    events: AsyncIterable<AgentEvent>;
  }) {
    const { id, stop, events } = params;

    try {
      yield* events;
    } finally {
      if (this.#running.get(id) === stop) this.#running.delete(id);
    }
  }
}

/**
 * Parts as text, for a conversation without skills: a skill part reads `/<name>` and runs
 * nothing, since there are no skills to run.
 */
function textOf(parts: readonly PromptPart[]): string {
  return parts.map((part) => (part.type === 'text' ? part.text : `/${part.name}`)).join('');
}
