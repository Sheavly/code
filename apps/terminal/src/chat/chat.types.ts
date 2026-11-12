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
>;

/** What `ChatSession.stop` found: a prompt to stop, one already stopping, or nothing running. */
export type StopResult = 'stopped' | 'stopping' | 'idle';

/** How a message ended: its prompt ran (even if stopped), or failed with an error that was shown. */
export type TurnOutcome = 'completed' | 'failed';

/** The main run's `run_state` event, as the chat tells a UI. */
export type RunState = { state: 'working' | 'waiting'; groupedTasks: number };
