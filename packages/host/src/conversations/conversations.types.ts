import type { Harness } from '../host/host.types.js';
import type { Conversation } from '../conversation/conversation.types.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message, PromptPart } from '@sheavly/protocol/message/message.types';
import type {
  ConversationDetails,
  ConversationSummary,
  SendPromptRequest,
} from '@sheavly/protocol/server/server.types';
import type { SkillInfo } from '@sheavly/protocol/skill/skill.types';

/**
 * What a prompt sends once its skills ran: the text the model reads, and what the user typed
 * (`parts`) when skills ran, for the history. `unknown`: skills a prompt's parts picked that no
 * one has; the prompt isn't sent (the UI's list is stale).
 */
export type PreparedPrompt =
  { text: string; parts?: PromptPart[] | undefined } | { unknown: readonly string[] };

/**
 * What a conversation's skills are, when it has any (a coding UI's, from the workspace). The
 * host knows nothing of skills: the app that builds a conversation gives these.
 */
export type ConversationSkills = {
  /** The skills a prompt can run, for a UI's `/` menu. */
  list: (params: { signal?: AbortSignal | undefined }) => Promise<SkillInfo[]>;
  /** Turns a prompt into what to send: runs the skills its text mentions or its parts pick. */
  prepare: (params: {
    prompt: SendPromptRequest;
    signal?: AbortSignal | undefined;
  }) => Promise<PreparedPrompt>;
};

/**
 * What a conversation's run is, as the app that built it says: the workspace, the model in use
 * and the ones it can switch to, workspace trust and the allow list. The host only passes it on.
 */
export type ConversationRun = {
  details: () => Omit<ConversationDetails, keyof ConversationSummary>;
  /** Switches to the model named `name`, from the next model call; false when there is none. */
  useModel: (name: string) => boolean;
};

/** One live conversation the app built: its services, the conversation, and its skills if any. */
export type LiveConversation = {
  harness: Harness;
  conversation: Conversation;
  skills?: ConversationSkills | undefined;
  /** What the run is, for `GET /conversations/:id`; without it, the details are unknown. */
  run?: ConversationRun | undefined;
  /** Releases what the app opened for it (its processes, a workspace); after `close`. */
  dispose?: (() => Promise<void>) | undefined;
};

/**
 * Builds one conversation, as the app decides it: the provider, tools and hooks, and its skills.
 * `messages` is history to continue from. The host picks none of it.
 */
export type CreateConversation = (params: {
  messages?: Message[] | undefined;
}) => Promise<LiveConversation>;

/** One prompt's events, and the text and parts it sent. */
export type SentPrompt = {
  events: AsyncIterable<AgentEvent>;
  text: string;
  parts?: PromptPart[] | undefined;
};
