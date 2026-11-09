import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import type {
  Message,
  ToolCall,
  ToolMessage,
  TurnStopReason,
} from '@sheavly/protocol/message/message.types';

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
  /** The window and how much of it the last call used (a snapshot), e.g. to decide to compact. */
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
  /** Wraps each tool call: block it, change its input or result. Throwing becomes an error result. */
  aroundToolCall?: ((context: ToolCallContext) => Promise<ToolResult>) | undefined;
  /** After each turn (reply and tool results in history): observe, record. Throwing fails the run. */
  afterTurn?: ((context: AfterTurnContext) => Promise<void>) | undefined;
  /** When the run fails, before the error reaches the caller: log, report. Its own errors are ignored. */
  onError?: ((context: ErrorContext) => Promise<void>) | undefined;
};

/** The handler names: everything on `Hook` except `name`. */
export type HookHandlerName = Exclude<keyof Hook, 'name'>;
