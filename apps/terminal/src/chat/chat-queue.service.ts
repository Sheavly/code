import { BackendError } from '../errors/backend.errors.js';
import { waitForFollowupAcceptance } from './followup-acceptance.helper.js';
import { parseChatInput } from './chat.utils.js';

/** Orders input while forwarding prompt text to a live run; commands keep their queue position. */
export class ChatQueue {
  #lines: { text: string }[] = [];
  #forwarding: Promise<void> | undefined;
  #acceptance: AbortController | undefined;
  #refused: AbortSignal | undefined;

  constructor(private readonly onQueue: (queue: readonly string[]) => void) {}

  get queued(): readonly string[] {
    return this.#lines.map(({ text }) => text);
  }

  push(text: string): void {
    this.#lines.push({ text });
    this.#changed();
  }

  /** Waits for any in-flight acceptance decision before starting a queued prompt. */
  async take(): Promise<string | undefined> {
    while (this.#forwarding) await this.#forwarding;
    const line = this.#lines.shift();

    this.#changed();

    return line?.text;
  }

  /** Cancels only acceptance waiting; possibly delivered text is reported and never replayed. */
  cancelForwarding(): void {
    this.#acceptance?.abort(
      new BackendError({ message: 'Follow-up acceptance cancelled; delivery is uncertain.' }),
    );
  }

  drop(): void {
    this.cancelForwarding();
    this.#lines = [];
    this.#changed();
  }

  /** Starts forwarding once, in order. An idle/stopping response keeps the input for the next run. */
  forward(params: {
    signal: AbortSignal;
    send: (text: string, signal: AbortSignal) => Promise<boolean>;
    onError: (caughtError: unknown) => void;
  }): void {
    if (this.#forwarding || params.signal.aborted || this.#refused === params.signal) return;
    const acceptance = new AbortController();

    this.#acceptance = acceptance;
    this.#forwarding = this.#forward({
      ...params,
      signal: AbortSignal.any([params.signal, acceptance.signal]),
      runSignal: params.signal,
    }).finally(() => {
      this.#acceptance = undefined;
      this.#forwarding = undefined;
    });
  }

  async #forward(params: {
    signal: AbortSignal;
    runSignal: AbortSignal;
    send: (text: string, signal: AbortSignal) => Promise<boolean>;
    onError: (caughtError: unknown) => void;
  }): Promise<void> {
    while (!params.signal.aborted) {
      const line = this.#lines[0];

      if (!line) return;
      const parsed = parseChatInput(line.text);

      if (parsed.kind !== 'prompt') return;

      try {
        if (!(await waitForFollowupAcceptance({ ...params, text: parsed.text }))) {
          this.#refused = params.runSignal;

          return;
        }
      } catch (caughtError) {
        // A failed response may follow server acceptance. Report it, never replay it automatically.
        this.#refused = params.runSignal;
        params.onError(caughtError);
      }

      if (this.#lines[0] !== line) return;
      this.#lines.shift();
      this.#changed();
      if (this.#refused === params.runSignal) return;
    }
  }

  #changed(): void {
    this.onQueue(this.queued);
  }
}
