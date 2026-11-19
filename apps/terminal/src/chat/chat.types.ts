import type { RunOutcome } from '@sheavly/protocol/session/session.types';
import type { RemoteConversation } from '../client/conversation.service.js';
import type { LinkFile } from '../changes/changes.types.js';
import type { Renderer } from '../render/render.service.js';
import type { Palette } from '../theme/theme.types.js';

/** What a chat needs to print about the file changes and failures its renderer has seen. */
export type Describer = {
  renderer: Renderer;
  palette: Palette;
  columns: () => number;
  linkFile: LinkFile;
};

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
  | { kind: 'effort'; name: string | undefined }
  /** `/changes` lists the files changed; `/changes <file or #n or all>` shows diffs. */
  | { kind: 'changes'; target: string | undefined }
  /** `/errors` lists the failed steps with more to say; `/errors #<n>` shows one in full. */
  | { kind: 'errors'; target: string | undefined }
  /** A chat command typed with arguments it does not take: reported, never sent to the model. */
  | { kind: 'usage'; message: string }
  | { kind: 'empty' };

/** What the chat needs of a conversation: a `RemoteConversation`, or a stand-in for a test. */
export type ChatConversation = Pick<
  RemoteConversation,
  'send' | 'yieldPrompt' | 'skills' | 'details' | 'useModel'
> &
  Partial<Pick<RemoteConversation, 'queue' | 'setQueue' | 'stop'>>;

/**
 * How a message ended: the main run's outcome from its `done`, or `failed` when the prompt threw
 * before one arrived (the backend went away, a request was refused). A stopped prompt is
 * `interrupted`, never `completed`. The same vocabulary as a run's, so a UI maps it once.
 */
export type TurnOutcome = RunOutcome;

/** The main run's `run_state` event, as the chat tells a UI. */
export type RunState = { state: 'working' | 'waiting'; groupedTasks: number };
