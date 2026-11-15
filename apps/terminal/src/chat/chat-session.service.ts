import type { Renderer } from '../render/render.service.js';
import type { RunningTool, Write } from '../render/render.types.js';
import { defaultPalette } from '../theme/palette.utils.js';
import type { Palette } from '../theme/theme.types.js';
import { unknownPromptCommand } from './chat-prompt.helper.js';
import { changesText } from '../changes/changes-text.utils.js';
import type { LinkFile } from '../changes/changes.types.js';
import { failuresText } from '../failures/failures-text.utils.js';
import { CHAT_HELP, LINE_COLUMNS, YIELD_REQUEST_MS } from './chat.constants.js';
import { ChatQueue } from './chat-queue.service.js';
import type { ChatConversation, RunState, StopResult, TurnOutcome } from './chat.types.js';
import { errorText, mainRunState, parseChatInput } from './chat.utils.js';
import { runModelCommand, runModeCommand } from './chat-model.helper.js';
import { runEnd } from '@sheavly/protocol/status/run-end.utils';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

/**
 * The chat's logic, apart from how a person types to it or sees it: lines go in (`submit`), the
 * conversation's output comes out through `write`. Input entered during a run waits its turn
 * in `onQueue` and is never delivered to the active run, which is only asked to yield at its
 * completion point rather than wait for background work. A UI decides what a key does (Ctrl+C
 * is `stop`) and what to show; this only does it.
 *
 * The chat's commands (`/help`, `/model`, `/exit`) and skills (`/<name>`) are read here, so every
 * UI that has a text box treats them the same.
 */
export class ChatSession {
  readonly #conversation: ChatConversation;
  readonly #renderer: Renderer;
  readonly #mainSession: string;
  readonly #write: Write;
  readonly #queue: ChatQueue;
  readonly #onBusy: (busy: boolean) => void;
  readonly #onSend: (text: string) => void;
  readonly #onTurnEnd: (outcome: TurnOutcome) => void;
  readonly #onReplyComplete: () => void;
  readonly #linkFile: LinkFile;
  readonly #onTools: (tools: readonly RunningTool[]) => void;
  readonly #onUsage: (entry: StreamEntry) => void;
  readonly #onExit: () => void;
  readonly #columns: () => number;
  readonly #palette: Palette;
  readonly #onThinking: (thinking: boolean) => void;
  readonly #onRunState: (state: RunState) => void;
  #reportedTools: readonly RunningTool[];
  #reportedThinking = false;
  #current: AbortController | undefined;
  /** Whether the running prompt's stream has started, so the backend is running it. */
  #streamOpen = false;
  /** Settles when every yield request sent so far has been answered. */
  #yielding: Promise<void> = Promise.resolve();
  /** The newest entry shown: a prompt's stream and the live feed overlap, so each shows an entry once. */
  #shownSeq = -1;
  /** A run the backend started itself is going, as the live feed tells: Ctrl+C then stops it. */
  #wakeLive = false;
  #draining = false;
  /** What the UI was last told, so `onBusy` fires on a change only. */
  #reportedBusy = false;
  #ended = false;
  #idle: Promise<void> = Promise.resolve();

  constructor(params: {
    conversation: ChatConversation;
    renderer: Renderer;
    /** The id of the conversation's main session: only its events are shown. */
    mainSession: string;
    write: Write;
    /** Told whenever the lines waiting their turn change. */
    onQueue?: (queue: readonly string[]) => void;
    /** Told when the chat starts running lines, and when it has run them all. */
    onBusy?: (busy: boolean) => void;
    /** Told when a message starts running (not when it is queued), so a UI can show it. */
    onSend?: (text: string) => void;
    /** Told when a message has run to its end, after all its output was written. */
    onTurnEnd?: (outcome: TurnOutcome) => void;
    /** After all output, only for a backend-confirmed completed prompt, never errors or stops. */
    onReplyComplete?: () => void;
    /** Makes a file path in what `/changes` prints a link; a path as it is if none. */
    linkFile?: LinkFile;
    /** Told whenever the set of tools running changes, so a UI can show what it waits on. */
    onTools?: (tools: readonly RunningTool[]) => void;
    /** Told when the main session's model starts or stops signalling reasoning. */
    onThinking?: (thinking: boolean) => void;
    /**
     * Told when the main run says it works, or is held open waiting on this many grouped tasks
     * (0 when only ungrouped tasks or services remain, so a follow-up can be sent).
     */
    onRunState?: (state: RunState) => void;
    /** Usage entries from every session, including sub-agents; seq allows replay deduplication. */
    onUsage?: (entry: StreamEntry) => void;
    /** Told once, when the user asked to leave. */
    onExit: () => void;
    /** The terminal's width now, which a diff is cut to; a plain line terminal has none. */
    columns?: () => number;
    /** The colours of what `/changes` and `/errors` print; the default theme's if none. */
    palette?: Palette;
  }) {
    this.#conversation = params.conversation;
    this.#renderer = params.renderer;
    this.#reportedTools = params.renderer.running;
    this.#mainSession = params.mainSession;
    this.#write = params.write;
    this.#queue = new ChatQueue(params.onQueue ?? (() => undefined));
    this.#onBusy = params.onBusy ?? (() => undefined);
    this.#onSend = params.onSend ?? (() => undefined);
    this.#onTurnEnd = params.onTurnEnd ?? (() => undefined);
    this.#onReplyComplete = params.onReplyComplete ?? (() => undefined);
    this.#linkFile = params.linkFile ?? ((path) => path);
    this.#onTools = params.onTools ?? (() => undefined);
    this.#onThinking = params.onThinking ?? (() => undefined);
    this.#onRunState = params.onRunState ?? (() => undefined);
    this.#onUsage = params.onUsage ?? (() => undefined);
    this.#onExit = params.onExit;
    this.#columns = params.columns ?? (() => LINE_COLUMNS);
    this.#palette = params.palette ?? defaultPalette;
  }

  /** Whether a line is being run now. */
  get busy(): boolean {
    return this.#draining;
  }

  /** Pending input, oldest first, outside the conversation's history until it runs. */
  get queued(): readonly string[] {
    return this.#queue.queued;
  }

  /** Queues input to run after the active prompt, which is asked to yield, not interrupted. */
  submit(line: string): void {
    if (this.#ended) return;
    this.#queue.push(line);
    if (this.#draining) this.#requestYield();
    else this.#idle = this.#drain();
  }

  /** What `/changes <target>` says: the files changed in this chat, or the diffs `target` names. */
  describeChanges(target?: string): string {
    return changesText({
      edits: this.#renderer.changes.edits,
      target,
      columns: this.#columns(),
      palette: this.#palette,
      linkFile: this.#linkFile,
    });
  }

  /** What `/errors <target>` says: the failed steps with more to say, or the one `target` names. */
  describeFailures(target?: string): string {
    return failuresText({
      failures: this.#renderer.failures.failures,
      target,
      palette: this.#palette,
    });
  }

  /**
   * The newest collapsed line's whole text, for a key that expands it: a failure's message or a
   * file change's diff, whichever was printed last; says so when there is neither.
   */
  describeLatest(): string {
    const failure = this.#renderer.failures.failures.at(-1);

    if (failure && this.#renderer.latestExpandable === 'failure') {
      return this.describeFailures(String(failure.number));
    }

    const change = this.#renderer.changes.edits.at(-1);

    return this.describeChanges(change && String(change.number));
  }

  /** Resolves when nothing runs and nothing waits. */
  idle(): Promise<void> {
    return this.#idle;
  }

  /**
   * Stops the running prompt; its history stays valid and the next line continues from it. Lines
   * waiting still run after it: stopping a prompt is not leaving.
   */
  stop(): StopResult {
    if (!this.#current && this.#wakeLive) {
      void this.#conversation.stop?.();

      return 'stopped';
    }

    if (!this.#current) return 'idle';
    if (this.#current.signal.aborted) return 'stopping';
    this.#current.abort();

    return 'stopped';
  }

  /**
   * Shows lines kept from an earlier run as waiting, without running them: reopening a
   * conversation never sends pending input by itself. They run when the user next submits a line.
   */
  restoreQueued(lines: readonly string[]): void {
    this.#queue.restore(lines);
  }

  /** Drops the lines waiting, which a user who is leaving does not want sent. */
  dropQueued(): void {
    this.#queue.drop();
  }

  async #drain(): Promise<void> {
    this.#draining = true;
    this.#reportBusy();

    try {
      while (true) {
        const line = this.#queue.take();

        if (line === undefined) break;
        if (!(await this.#handle(line))) break;
      }
    } finally {
      this.#draining = false;
      this.#reportBusy();
    }
  }

  /** Busy while lines run or a run the backend started itself goes; told once per change. */
  #reportBusy(): void {
    const busy = this.#draining || this.#wakeLive;

    if (busy === this.#reportedBusy) return;
    this.#reportedBusy = busy;
    this.#onBusy(busy);
  }

  /** Handles one line; false once the user asked to leave. */
  async #handle(line: string): Promise<boolean> {
    const parsed = parseChatInput(line);

    switch (parsed.kind) {
      case 'exit':
        this.#ended = true;
        this.dropQueued();
        this.#onExit();

        return false;
      case 'help':
        this.#print(CHAT_HELP);
        break;
      case 'usage':
        this.#print(`${parsed.message} /help lists the commands.`);
        break;
      case 'changes':
        this.#print(this.describeChanges(parsed.target));
        break;
      case 'errors':
        this.#print(this.describeFailures(parsed.target));
        break;
      case 'model':
        await this.#printCommand(() =>
          runModelCommand({ conversation: this.#conversation, typed: parsed.name }),
        );
        break;
      case 'mode':
        await this.#printCommand(() =>
          runModeCommand({ conversation: this.#conversation, typed: parsed.name }),
        );
        break;
      case 'prompt':
        await this.#send(parsed.text);
        break;
      case 'empty':
        break;
    }

    return true;
  }

  #print(text: string): void {
    this.#write(`${text}\n`);
  }

  async #printCommand(run: () => Promise<string>): Promise<void> {
    try {
      this.#print(await run());
    } catch (caughtError) {
      this.#print(`✗ ${errorText(caughtError)}`);
    }
  }

  /**
   * Runs one message to its end, printing its entries; a failure is shown, and the chat goes on.
   * Skills it mentions (`/<name>` anywhere in it) run with it; one it starts with that no skill
   * has is an unknown command, reported instead of sent.
   */
  async #send(text: string): Promise<void> {
    const current = new AbortController();

    let outcome: TurnOutcome = 'completed';

    // Set first so Ctrl+C works while waiting: a yield still in flight for the previous prompt
    // must land before this one starts, or it would end this prompt early instead.
    this.#current = current;
    // The user's prompt ends any wake (the backend settles it), so Ctrl+C is the prompt's now.
    this.#wakeLive = false;
    await Promise.race([
      this.#yielding,
      new Promise((resolve) => current.signal.addEventListener('abort', resolve, { once: true })),
    ]);

    try {
      // Stopped while waiting for a yield answer: the prompt never reaches the backend, so it is
      // not shown as sent either.
      if (current.signal.aborted) {
        this.#onTurnEnd('interrupted');

        return;
      }

      this.#onSend(text);

      const unknown = await unknownPromptCommand({ text, conversation: this.#conversation });

      if (unknown) {
        this.#print(`Unknown command /${unknown}; /help lists them.`);
        this.#onTurnEnd(outcome);

        return;
      }

      outcome = await this.#showEntries({ text, signal: current.signal });
    } catch (caughtError) {
      outcome = 'failed';
      this.#write(`\n✗ ${errorText(caughtError)}\n`);
    } finally {
      this.#current = undefined;
      this.#streamOpen = false;
      // A failure or a stop can end the stream without the result of a call that was running.
      this.#renderer.clearRunning();
      this.#reportLiveState();
    }

    this.#write('\n');
    if (outcome === 'completed' && !current.signal.aborted) this.#onReplyComplete();
    this.#onTurnEnd(outcome);
  }

  /**
   * Shows an entry the backend sent outside any prompt of this chat: the run it starts itself when
   * background work finishes while the chat is idle. Entries a prompt's own stream already
   * showed are skipped.
   */
  hear(entry: StreamEntry): void {
    // An entry a prompt's own stream showed arrives here again from the live feed: it says nothing
    // new about a run, so it must not start or end a wake.
    const fresh = this.#show(entry);

    if (!fresh || entry.sessionId !== this.#mainSession || this.#current) return;

    const ended = runEnd(entry) !== undefined;

    if (entry.kind === 'event' || ended) this.#wakeLive = !ended;

    // No prompt of this chat carries a wake run, so its start and end are told here.
    this.#reportBusy();

    if (!ended) return;

    // A stopped or failed run can end without the result of a call that was running.
    this.#renderer.clearRunning();
    this.#reportLiveState();
  }

  /** Shows an entry once by seq; false when it was shown already. */
  #show(entry: StreamEntry): boolean {
    if (entry.seq <= this.#shownSeq) return false;
    this.#shownSeq = entry.seq;

    if (entry.kind === 'event' && entry.event.type === 'usage') this.#onUsage(entry);

    const run = mainRunState({ entry, mainSession: this.#mainSession });

    if (run) this.#onRunState(run);

    this.#renderer.entry(entry, this.#mainSession);
    this.#reportLiveState();

    return true;
  }

  /** Prints a message's entries as they stream, telling the UI when the running tools or thinking change. */
  async #showEntries(params: { text: string; signal: AbortSignal }): Promise<TurnOutcome> {
    let outcome: TurnOutcome | undefined;

    for await (const entry of this.#conversation.send(params)) {
      if (!this.#streamOpen) {
        this.#streamOpen = true;
        if (this.#queue.queued.length > 0) this.#requestYield();
      }

      this.#show(entry);

      outcome = runEnd(entry) ?? outcome;
    }

    // A stream that closes without the main run's `done` did not finish its run: the user's stop
    // cut it short, or the connection went.
    return outcome ?? (params.signal.aborted ? 'interrupted' : 'failed');
  }

  /**
   * Asks the running prompt to end at its completion point so queued input is not stuck behind
   * background work. Only an open stream is asked: before it, the backend may not be running the
   * prompt yet and would refuse, so `#showEntries` asks again at the first entry. A failed
   * request is shown, not retried: the line still runs when the prompt ends.
   */
  #requestYield(): void {
    if (!this.#streamOpen) return;

    const request = this.#conversation.yieldPrompt(AbortSignal.timeout(YIELD_REQUEST_MS)).then(
      () => undefined,
      (caughtError: unknown) => {
        this.#write(`\n✗ Could not ask the agent to yield: ${errorText(caughtError)}\n`);
      },
    );

    this.#yielding = Promise.all([this.#yielding, request]).then(() => undefined);
  }

  /** Tells the UI the running tools and whether the model thinks, for what changed since. */
  #reportLiveState(): void {
    this.#reportThinking();
    this.#reportTools();
  }

  /** Tells the UI whether the model thinks, when that is not what it was last told. */
  #reportThinking(): void {
    if (this.#renderer.thinking === this.#reportedThinking) return;
    this.#reportedThinking = this.#renderer.thinking;
    this.#onThinking(this.#reportedThinking);
  }

  /** Tells the UI the running tools, when they are not the ones it was last told. */
  #reportTools(): void {
    if (this.#renderer.running === this.#reportedTools) return;
    this.#reportedTools = this.#renderer.running;
    this.#onTools(this.#reportedTools);
  }
}
