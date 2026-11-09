import { createWriteStream, type WriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { now } from '@sheavly/core/clock/clock.helper';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { WorkbookStoreError } from '../errors/workbook.errors.js';
import type { RunMeta, RunPaths, RunResult } from './workbook.types.js';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { HistoryMessage } from '@sheavly/protocol/message/message.types';

/**
 * Captures everything one run outputs, into its run folder, as it happens: the main session's
 * loop events, the conversation's SSE stream (what a UI reads), the terminal transcript, and at
 * the end the conversation and a result. The backend appends each model call (full request) to
 * the run's `model-calls.jsonl` itself. Streams are appended line by line, so if the process dies
 * mid-run, everything up to that moment is on disk (`result.json` is then missing: unfinished).
 */
export class RunRecorder {
  readonly #events: WriteStream;
  readonly #transcript: WriteStream;
  #stopSse: AbortController | undefined;
  #sseWritten: Promise<void> = Promise.resolve();
  #counts = { events: 0, toolCalls: 0, toolErrors: 0 };
  #lastEvent: string | undefined;
  readonly #startedAt = now();

  constructor(private readonly paths: RunPaths) {
    this.#events = createWriteStream(paths.events);
    this.#transcript = createWriteStream(paths.transcript);
  }

  /** Writes `run.json`: what this run is, before anything happens. */
  async start(meta: RunMeta): Promise<void> {
    await writeFile(this.paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
  }

  /** Records the conversation's SSE stream until `finish`, which aborts `stop` to end it. */
  recordSessions(stream: ReadableStream<Uint8Array>, stop: AbortController): void {
    this.#stopSse = stop;
    this.#sseWritten = stream
      .pipeTo(Writable.toWeb(createWriteStream(this.paths.sessions)) as WritableStream<Uint8Array>)
      .catch((caughtError: unknown) => {
        // `finish` ends the stream by aborting it: expected, the file has everything up to there.
        if (!stop.signal.aborted) throw caughtError;
      });
  }

  /** One loop event of the main session. */
  event(event: EntryEvent): void {
    this.#counts.events++;
    this.#lastEvent = `#${event.seq} ${event.type}`;

    if (event.type === 'tool_result') {
      this.#counts.toolCalls++;
      if (event.message.role === 'tool' && event.message.isError) this.#counts.toolErrors++;
    }

    this.#events.write(`${JSON.stringify(event)}\n`);
  }

  /** Everything printed to the terminal, unchanged. */
  transcript(text: string): void {
    this.#transcript.write(text);
  }

  /**
   * Writes the conversation and `result.json`, and closes every stream. Called on every ending,
   * including failures, so a failed run still has its result. The model calls are counted from the
   * file the backend wrote.
   */
  async finish(params: {
    outcome: RunResult['outcome'];
    error?: string | undefined;
    messages: HistoryMessage[];
    sessions: number;
  }): Promise<RunResult> {
    const { outcome, error, messages, sessions } = params;

    this.#stopSse?.abort();
    // The stream closes cleanly on abort, so a failure here is a real one: the sessions file
    // couldn't be written. Everything else is still written first, so the run keeps its result
    // and conversation; then the failure is thrown, naming the file.
    const sessionsFailure = await this.#sseWritten.then(
      () => undefined,
      (caughtError: unknown) =>
        new WorkbookStoreError({ file: this.paths.sessions, cause: caughtError }),
    );

    await Promise.all([this.#events, this.#transcript].map(close));

    const result: RunResult = {
      outcome,
      ...(error !== undefined && { error }),
      endedAt: now(),
      durationMs: now() - this.#startedAt,
      ...this.#counts,
      modelCalls: await countLines(this.paths.modelCalls),
      sessions,
      messages: messages.length,
      ...(this.#lastEvent !== undefined && { lastEvent: this.#lastEvent }),
    };

    await writeFile(this.paths.messages, `${JSON.stringify(messages, null, 2)}\n`);
    await writeFile(this.paths.result, `${JSON.stringify(result, null, 2)}\n`);

    if (sessionsFailure) throw sessionsFailure;

    return result;
  }
}

function close(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

/** How many lines `file` has: none when the backend never wrote it (no model call was made). */
async function countLines(file: string): Promise<number> {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).length;
  } catch (caughtError) {
    if (isMissingPath(caughtError)) return 0;
    throw new WorkbookStoreError({ file, cause: caughtError });
  }
}
