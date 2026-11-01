import { createWriteStream, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import type { Message } from '@sheavly/core/message/message.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { AgentEvent } from '../loop/events/events.types.js';
import { WorkbookStoreError } from '../runtime/errors/workbook.errors.js';
import type { SessionRegistry } from '../runtime/sessions/sessions.service.js';
import type { RunMeta, RunPaths, RunResult } from './workbook.types.js';

/**
 * Captures everything one run outputs, into its run folder, as it happens: every loop event,
 * every model call (full request), the session SSE stream, the terminal transcript, and at the
 * end the conversation and a result. Streams are appended line by line, so if the process dies
 * mid-run, everything up to that moment is on disk (`result.json` is then missing: unfinished).
 */
export class RunRecorder {
  readonly #events: WriteStream;
  readonly #modelCalls: WriteStream;
  readonly #transcript: WriteStream;
  readonly #stopSse = new AbortController();
  #sseWritten: Promise<void> = Promise.resolve();
  #counts = { events: 0, modelCalls: 0, toolCalls: 0, toolErrors: 0 };
  #lastEvent: string | undefined;
  readonly #startedAt = Date.now();

  constructor(private readonly paths: RunPaths) {
    this.#events = createWriteStream(paths.events);
    this.#modelCalls = createWriteStream(paths.modelCalls);
    this.#transcript = createWriteStream(paths.transcript);
  }

  /** Writes `run.json`: what this run is, before anything happens. */
  async start(meta: RunMeta): Promise<void> {
    await writeFile(this.paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
  }

  /** Records the registry's server-sent event stream (what a UI would read) until `finish`. */
  recordSessions(sessions: SessionRegistry): void {
    this.#sseWritten = sessions
      .stream({ signal: this.#stopSse.signal })
      .pipeTo(Writable.toWeb(createWriteStream(this.paths.sessions)) as WritableStream<Uint8Array>);
  }

  event(event: AgentEvent): void {
    this.#counts.events++;
    this.#lastEvent = `#${event.seq} ${event.type}`;

    if (event.type === 'tool_result') {
      this.#counts.toolCalls++;
      if (event.message.role === 'tool' && event.message.isError) this.#counts.toolErrors++;
    }

    this.#events.write(`${JSON.stringify(event)}\n`);
  }

  modelCall(request: ProviderRequest): void {
    this.#counts.modelCalls++;
    // The signal can't be serialized; everything else is what the model was sent.
    const { signal: _signal, ...sent } = request;

    this.#modelCalls.write(
      `${JSON.stringify({ at: new Date().toISOString(), ...sent, tools: sent.tools.map((tool) => tool.name) })}\n`,
    );
  }

  /** Everything printed to the terminal, unchanged. */
  transcript(text: string): void {
    this.#transcript.write(text);
  }

  /**
   * Writes the conversation and `result.json`, and closes every stream. Called on every ending,
   * including failures, so a failed run still has its result.
   */
  async finish(params: {
    outcome: RunResult['outcome'];
    error?: string | undefined;
    messages: Message[];
    sessions: number;
  }): Promise<RunResult> {
    const { outcome, error, messages, sessions } = params;
    const result: RunResult = {
      outcome,
      ...(error !== undefined && { error }),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - this.#startedAt,
      ...this.#counts,
      sessions,
      messages: messages.length,
      ...(this.#lastEvent !== undefined && { lastEvent: this.#lastEvent }),
    };

    this.#stopSse.abort();
    // The stream closes cleanly on abort, so a failure here is a real one: the sessions file
    // couldn't be written. Everything else is still written first, so the run keeps its result
    // and conversation; then the failure is thrown, naming the file.
    const sessionsFailure = await this.#sseWritten.then(
      () => undefined,
      (caughtError: unknown) =>
        new WorkbookStoreError({ file: this.paths.sessions, cause: caughtError }),
    );

    await Promise.all([this.#events, this.#modelCalls, this.#transcript].map(close));
    await writeFile(this.paths.messages, `${JSON.stringify(messages, null, 2)}\n`);
    await writeFile(this.paths.result, `${JSON.stringify(result, null, 2)}\n`);

    if (sessionsFailure) throw sessionsFailure;

    return result;
  }
}

function close(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}
