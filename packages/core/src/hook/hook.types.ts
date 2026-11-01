import type { Message, ToolCall, ToolMessage, TurnStopReason } from '../message/message.types.js';

/** What a tool call produced. The loop turns it into the history message for the call. */
export type ToolResult = Pick<ToolMessage, 'content' | 'isError'>;

/** For handlers that add context: the history so far (a snapshot) and a way to add to it. */
type ContextAccess = {
  messages: readonly Message[];
  signal: AbortSignal;
  /** Adds a user message the model sees from the next model call on. It stays in history. */
  addContext: (content: string) => void;
};

/** What `sessionStart` receives, once, before the run's first turn. */
export type SessionStartContext = ContextAccess;

/** What `beforeTurn` receives, just before the model is called. */
export type BeforeTurnContext = ContextAccess & { turn: number };

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
  /** Wraps each tool call: block it, change its input or result. Throwing becomes an error result. */
  aroundToolCall?: ((context: ToolCallContext) => Promise<ToolResult>) | undefined;
  /** After each turn (reply and tool results in history): observe, record. Throwing fails the run. */
  afterTurn?: ((context: AfterTurnContext) => Promise<void>) | undefined;
  /** When the run fails, before the error reaches the caller: log, report. Its own errors are ignored. */
  onError?: ((context: ErrorContext) => Promise<void>) | undefined;
};

/** The handler names: everything on `Hook` except `name`. */
export type HookHandlerName = Exclude<keyof Hook, 'name'>;
