import { randomUUID } from 'node:crypto';
import { ConversationsError } from '../errors/conversations.errors.js';
import type { CreateConversation, LiveConversation, SentPrompt } from './conversations.types.js';
import { matchesSearch } from './conversations.utils.js';
import type { ApprovalId, ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message, PromptPart } from '@sheavly/protocol/message/message.types';
import type {
  ConversationDetails,
  ConversationId,
  ConversationSummary,
  SendPromptRequest,
} from '@sheavly/protocol/server/server.types';
import { conversationIdSchema } from '@sheavly/protocol/server/server.validator';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';

/**
 * The live conversations a host serves, by id: each built by the app's `create`, with the
 * operations a UI calls on them. No transport: an in-process UI calls these directly, and the
 * HTTP server only turns requests into these calls, so both behave the same.
 */
export class Conversations {
  readonly #create: CreateConversation;
  readonly #live = new Map<ConversationId, LiveConversation>();
  /** Each conversation's running prompt's stop switch. */
  readonly #running = new Map<ConversationId, AbortController>();

  constructor(params: { create: CreateConversation }) {
    this.#create = params.create;
  }

  /** Starts a conversation, empty or continuing `messages`, and returns its id. */
  async start(params: { messages?: Message[] | undefined } = {}): Promise<ConversationId> {
    const id = conversationIdSchema.parse(randomUUID());

    this.#live.set(id, await this.#create({ messages: params.messages }));

    return id;
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

  /** Switches conversation `id` to the model `name` from its next model call, or `unknown_model`. */
  useModel(params: { id: ConversationId; name: string }): void {
    const { id, name } = params;

    if (!this.get(id).run?.useModel(name)) {
      throw new ConversationsError({
        reason: 'unknown_model',
        message: `No model ${name} in conversation ${id}; its details list the models`,
      });
    }
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

  /**
   * Sends the next prompt: runs the skills it mentions or picks (when the conversation has
   * skills), then starts it. Its events are the caller's to iterate; the combined stream has them
   * too. Throws `session_running` while another runs, `unknown_skill` for a picked skill no one
   * has, before anything starts.
   */
  async send(params: {
    id: ConversationId;
    prompt: SendPromptRequest;
    signal?: AbortSignal | undefined;
  }): Promise<SentPrompt> {
    const { id, prompt, signal } = params;
    const { conversation, skills } = this.get(id);
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

  /** Closes conversation `id`: stops its prompt, tasks and processes. It is gone after. */
  async close(id: ConversationId): Promise<void> {
    const live = this.get(id);

    this.#live.delete(id);
    this.#running.get(id)?.abort();
    await live.conversation.close();
    await live.dispose?.();
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
