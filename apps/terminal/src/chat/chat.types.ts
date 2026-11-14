import type { RunOutcome } from '@sheavly/protocol/session/session.types';
import type { RemoteConversation } from '../client/conversation.service.js';

/**
 * What the user typed at the chat prompt: one of the chat's commands (`/exit`, `/help`,
 * `/model [name]`), a message to send (trimmed, and running any skills it mentions), or nothing.
 */
export type ChatInput =
  | { kind: 'prompt'; text: string }
  | { kind: 'exit' }
  | { kind: 'help' }
  /** `/model` lists the models; `/model <name>` switches to one. */
  | { kind: 'model'; name: string | undefined }
  | { kind: 'mode'; name: string | undefined }
  /** `/changes` lists the files changed; `/changes <file or #n or all>` shows diffs. */
  | { kind: 'changes'; target: string | undefined }
  /** `/errors` lists the failed steps with more to say; `/errors #<n>` shows one in full. */
  | { kind: 'errors'; target: string | undefined }
  | { kind: 'empty' };

/** What the chat needs of a conversation: a `RemoteConversation`, or a stand-in for a test. */
export type ChatConversation = Pick<
  RemoteConversation,
  'send' | 'yieldPrompt' | 'skills' | 'details' | 'useModel' | 'runningTasks'
> &
  Partial<Pick<RemoteConversation, 'queue' | 'setQueue' | 'stop'>>;

/** What `ChatSession.stop` found: a prompt to stop, one already stopping, or nothing running. */
export type StopResult = 'stopped' | 'stopping' | 'idle';

/**
 * How a message ended: the main run's outcome from its `done`, or `failed` when the prompt threw
 * before one arrived (the backend went away, a request was refused). A stopped prompt is
 * `interrupted`, never `completed`. The same vocabulary as a run's, so a UI maps it once.
 */
export type TurnOutcome = RunOutcome;

/** The main run's `run_state` event, as the chat tells a UI. */
export type RunState = { state: 'working' | 'waiting'; groupedTasks: number };
