import type { EntryEvent } from '@sheavly/protocol/event/event.types';

/** Where a terminal front end's output goes (stdout, or stdout plus a log file). */
export type Write = (text: string) => void;

/**
 * Where the model's reply goes, apart from the rest of the run's output: a screen that draws
 * Markdown needs to know where the reply ends, since a block is only drawn once it is complete.
 * `end` says no more of this reply is coming.
 */
export type ReplySink = { write: Write; end: () => void };

/** What the last thing written was: the model's reply text, or anything else the run did. */
export type Section = 'reply' | 'activity';

/** The sub-agent a line is about: its title and id, and the indent for how deep it is. */
type SubAgent = { indent: string; title: string; id: string };

/**
 * How a conversation's events read on screen. The `Renderer` decides what to show and in what
 * order; a look decides the words, symbols and colours. Every method returns the text to write,
 * `''` for nothing. `gap` separates one section from the one before it.
 */
export type Look = {
  /** What goes between two sections, so a reply and the tool lines don't run together. */
  gap: (params: { from: Section | undefined; to: Section; lineOpen: boolean }) => string;
  toolStarted: (params: { description: string; command: string | undefined }) => string;
  parallel: (count: number) => string;
  toolResult: (params: { ok: boolean; label: string; detail: string; seconds: string }) => string;
  taskRunning: (params: { label: string; id: string }) => string;
  taskCompleted: (params: {
    ok: boolean;
    id: string;
    status: string;
    exit: string;
    elapsed: string;
    command: string;
    output: string;
  }) => string;
  steer: (firstLine: string) => string;
  contextAdded: (params: { hook: string; chars: number }) => string;
  hookFailed: (params: { hook: string; handler: string; error: string }) => string;
  turnEnd: (params: {
    stopReason: Extract<EntryEvent, { type: 'turn_end' }>['stopReason'];
    waiting: number;
  }) => string;
  done: (params: {
    reason: Extract<EntryEvent, { type: 'done' }>['reason'];
    events: number;
    reasoning: number;
  }) => string;
  subAgentStarted: (params: SubAgent & { depth: number; parent?: string; root?: string }) => string;
  subAgentStatus: (params: SubAgent & { status: string }) => string;
  subAgentMessage: (params: SubAgent & { from: string; content: string }) => string;
  subAgentEnded: (params: SubAgent & { state: string }) => string;
};
