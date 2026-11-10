import type { AgentEventBody, ToolArtifact } from '@sheavly/protocol/event/event.types';
import type {
  Message,
  SummaryMessage,
  ToolCall,
  ToolMessage,
  TurnStopReason,
} from '@sheavly/protocol/message/message.types';
import type { SummarySection } from '../summary/summary.types.js';

/** What a tool call produced: the text for history, and any artifacts (for the UI). */
export type ToolResult = Pick<ToolMessage, 'content' | 'isError'> & {
  artifacts?: readonly ToolArtifact[] | undefined;
};

/** For handlers that add context: the history so far (a snapshot) and a way to add to it. */
type ContextAccess = {
  messages: readonly Message[];
  signal: AbortSignal;
  /** Adds a user message the model sees from the next model call on. It stays in history. */
  addContext: (content: string) => void;
};

/** What `sessionStart` receives, once, before the run's first turn. */
export type SessionStartContext = ContextAccess;

/**
 * How full the model's context is: the numbers the loop tells the agent, so a hook decides from
 * the same ones. Each is left out when unknown.
 */
export type ContextState = {
  /** The model's context window in tokens. */
  window?: number | undefined;
  /**
   * Tokens the context held as of the last model call: its input plus its output, which becomes
   * input next turn. Not a total over calls. Left out before the first call, and when the
   * provider reported no usage.
   */
  used?: number | undefined;
};

/** What `beforeTurn` receives, just before the model is called. */
export type BeforeTurnContext = ContextAccess & {
  turn: number;
  /** The window and how much of it the last call used (a snapshot), e.g. to decide to summarize. */
  context: ContextState;
  /**
   * Adds system instructions for this turn's model call only (not history): call it every turn
   * the instructions should apply. Hooks' instructions follow the run's own, in hook order.
   */
  addInstructions: (content: string) => void;
};

/** What `beforeModelCall` receives: the messages about to be sent, and how full the context is. */
export type BeforeModelCallContext = {
  turn: number;
  /**
   * The messages this model call would send (a snapshot): the previous `beforeModelCall` hook's
   * result, or the run's history for the first. Changing the array changes nothing stored.
   */
  messages: readonly Message[];
  /** The window and how much of it the last call used (a snapshot), e.g. to decide to trim. */
  context: ContextState;
  signal: AbortSignal;
};

/** Why a summary runs: the context neared the window, a person asked, or a request overflowed. */
export type SummaryReason = Extract<AgentEventBody, { type: 'summary_started' }>['reason'];

/** What `beforeSummary` receives, before the summarizer is called. */
export type BeforeSummaryContext = {
  reason: SummaryReason;
  /** What a model is sent now, which the checkpoint will shorten (a snapshot). */
  messages: readonly Message[];
  /** The window and how much of it the last call used (a snapshot). */
  context: ContextState;
  signal: AbortSignal;
};

/**
 * What `beforeSummary` may return to shape the checkpoint; returning nothing changes nothing.
 * Both parts are optional and checked like the summarizer's own result: a `keepTokens` so large
 * that the checkpoint is not smaller than what it replaces, or sections that push it past the
 * policy's `maxSummaryTokens`, fail the summary like any rejected result, and a failed
 * threshold summary counts toward the policy's `maxFailures`.
 */
export type SummaryChange = {
  /**
   * About how many tokens of the newest messages stay word for word, instead of the policy's
   * `keepTokens`. The cut still never splits a tool call from its result; when nothing older
   * than that tail can be summarized, the policy's tail is used instead. Positive; with several
   * hooks the last one to return it wins.
   */
  keepTokens?: number | undefined;
  /**
   * Sections added to what the summarizer wrote; one with the same id replaces it, and a later
   * hook's replaces an earlier hook's. Ids must be unique within one result.
   */
  sections?: readonly SummarySection[] | undefined;
};

/**
 * What `afterSummary` receives, once the checkpoint is in history. The checkpoint and messages
 * are copies, so editing them changes nothing stored. The checkpoint's text comes from tool
 * output and model replies: `addContext` adds a user message, so never copy that text into it.
 */
export type AfterSummaryContext = ContextAccess & {
  reason: SummaryReason;
  /** The checkpoint that was just appended. */
  checkpoint: SummaryMessage;
};

/** What `afterTurn` receives, once the turn's reply and tool results are in history. */
export type AfterTurnContext = {
  turn: number;
  stopReason: TurnStopReason;
  /** The model's reply this turn (empty if it was interrupted before saying anything). */
  reply: Message;
  /** The history including this turn (a snapshot). */
  messages: readonly Message[];
  signal: AbortSignal;
};

/** What `onError` receives when the run fails; the error still ends the run. */
export type ErrorContext = {
  error: unknown;
  /** The history up to the failure (a snapshot). */
  messages: readonly Message[];
};

/** What `aroundToolCall` receives, for every tool call the model makes. */
export type ToolCallContext = {
  call: ToolCall;
  /** The model's plain-language note, e.g. "reading index.ts". */
  description: string;
  signal: AbortSignal;
  /**
   * Runs the rest of the chain: later hooks, then the tool. Pass `input` to replace the call's
   * input (it is validated as usual). Return without calling it to block the call.
   */
  next: (input?: unknown) => Promise<ToolResult>;
};

/**
 * A named set of handlers, one per point in the loop; each is optional. Hooks run in the order
 * they are given: one after another, except `aroundToolCall`, which nests (the first is
 * outermost). A run's hooks are an option of the loop, so a parent picks which hooks its
 * sub-agents get; each sub-agent run has its own `sessionStart`.
 */
export type Hook = {
  name: string;
  /** Once per run, before the first turn: set up, add opening context. Throwing fails the run. */
  sessionStart?: ((context: SessionStartContext) => Promise<void>) | undefined;
  /** Before each model call: look at the history, add context. Throwing fails the run. */
  beforeTurn?: ((context: BeforeTurnContext) => Promise<void>) | undefined;
  /**
   * After `beforeTurn`, before each model call: returns the messages to send instead, for that
   * call only (stored history is never changed). Return the input to change nothing. The result
   * must keep history valid: every tool call paired with its result, and the latest user message.
   * Make edits deterministic: a provider reuses the prompt prefix that is byte-identical to the
   * previous call. Throwing, or returning invalid history, fails the run.
   */
  beforeModelCall?: ((context: BeforeModelCallContext) => Promise<readonly Message[]>) | undefined;
  /**
   * Before a summary is written: choose how much stays word for word, or supply a section.
   * Return nothing to change nothing. The checkpoint is still checked, so a hook cannot leave
   * history invalid. Throwing fails the summary (a `summary_failed` event), never the run.
   */
  beforeSummary?:
    ((context: BeforeSummaryContext) => Promise<SummaryChange | undefined>) | undefined;
  /**
   * After a checkpoint is appended: add context back with `addContext`, such as instructions the
   * summary dropped. Throwing fails the run, like `afterTurn`.
   */
  afterSummary?: ((context: AfterSummaryContext) => Promise<void>) | undefined;
  /** Wraps each tool call: block it, change its input or result. Throwing becomes an error result. */
  aroundToolCall?: ((context: ToolCallContext) => Promise<ToolResult>) | undefined;
  /** After each turn (reply and tool results in history): observe, record. Throwing fails the run. */
  afterTurn?: ((context: AfterTurnContext) => Promise<void>) | undefined;
  /** When the run fails, before the error reaches the caller: log, report. Its own errors are ignored. */
  onError?: ((context: ErrorContext) => Promise<void>) | undefined;
};

/** The handler names: everything on `Hook` except `name`. */
export type HookHandlerName = Exclude<keyof Hook, 'name'>;
