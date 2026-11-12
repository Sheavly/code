import type {
  ApprovalId,
  ApprovalOption,
  ApprovalResponse,
} from '@sheavly/protocol/approval/approval.types';
import type { PermissionMode } from '@sheavly/protocol/permission/permission.types';
import type { ModelMode } from '@sheavly/protocol/model/model.types';
import type { RunningTool } from '../render/render.types.js';
import type { ContextUsage, UsageTotals } from '@sheavly/protocol/usage/usage.types';

/** One thing the user can answer an approval with, as the prompt lists it. */
export type ApprovalChoice = { option: ApprovalOption; label: string; hint: string };

/** An answer to send: which approval, and the decision. */
export type ApprovalAnswer = { id: ApprovalId; response: ApprovalResponse };

/** Where the prompt is: choosing among the options, or typing what to tell the model instead. */
export type ApprovalPhase = 'choose' | 'message';

/** What confirming a choice led to. */
export type ApprovalOutcome =
  { kind: 'answer'; answer: ApprovalAnswer } | { kind: 'needs_message' } | { kind: 'none' };

/** What a running screen chat gives back: wait for it to end, and end it. */
export type ScreenChat = {
  /** Resolves when the user left (`/exit`, or Ctrl+C twice). */
  finished: Promise<void>;
  /** Stops what the chat started on the backend and leaves the terminal as it was. */
  stop: () => Promise<void>;
};

/** What the line under the conversation says. */
export type StatusInfo = {
  state: 'ready' | 'working' | 'waiting';
  model: string;
  modelMode?: ModelMode;
  mode: PermissionMode;
  /**
   * The branch of the folder the agents work in, once they chose one: shown once here so paths
   * need not repeat the worktree. A detached HEAD shows as its own label.
   */
  workingBranch?: string | undefined;
  /** Background tasks still running. */
  tasks: number;
  /** Tool calls the prompt waits on now, which a screen that can animate shows with their time. */
  tools?: readonly RunningTool[];
  /** The model signalled reasoning; only shown while working, never claimed without a signal. */
  thinking?: boolean;
  usage?: UsageTotals;
  contextUsage?: ContextUsage;
};
