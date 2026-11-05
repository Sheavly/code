import type {
  ApprovalId,
  ApprovalOption,
  ApprovalResponse,
} from '@sheavly/protocol/approval/approval.types';
import type { PermissionMode } from '@sheavly/protocol/permission/permission.types';

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
  mode: PermissionMode;
  /** Background tasks still running. */
  tasks: number;
};
