import { isFileChange } from '@sheavly/coding/files/files.utils';
import { isFileRead } from '@sheavly/coding/read-file/read-file.utils';
import { now } from '@sheavly/core/clock/clock.helper';
import { logLook } from './log-look.utils.js';
import type { Look, ReplySink, Section, Write } from './render.types.js';
import { commandOf, describeRead, firstLine, seconds, shortId } from './render.utils.js';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';

type EventOf<T extends EntryEvent['type']> = Extract<EntryEvent, { type: T }>;

/**
 * The terminal front end of the chat, the demo and the workbook: one line (or block) per event of
 * the main session and per sub-agent update, from the backend's stream, written to `write`.
 * `runningTasks` says how many background tasks still run, from the stream's task entries. Kept
 * stateful only for the current tool batch size and the reasoning count.
 */
export class Renderer {
  #batchSize = 0;
  #reasoningItems = 0;
  #last: Section | undefined;
  #lineOpen = false;

  /**
   * `look` is how it reads: the complete plain log by default, or `chatLook` for a person.
   * `reply` is where the model's text goes; by default it is written like everything else.
   */
  constructor(
    private readonly write: Write,
    private readonly runningTasks: () => number,
    private readonly look: Look = logLook,
    private readonly reply: ReplySink = { write, end: () => undefined },
  ) {}

  /**
   * One entry of a prompt's stream: the main session's loop events, and sub-agents starting,
   * reporting and ending. A sub-agent's own events and the task entries aren't printed: its
   * updates and its task's completion say what it did.
   */
  entry(entry: StreamEntry, mainSession: string): void {
    if (entry.kind === 'event' && entry.sessionId === mainSession) this.event(entry.event);
    if (entry.kind === 'update') this.session(entry.update);
  }

  /** One loop event of the main session. */
  event(event: EntryEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.#reply(event.text);
        break;
      case 'reasoning':
        this.#reasoningItems++; // opaque; resent to the model automatically
        break;

      case 'tool_call_started':
        // Already running; its result is shown after the model's turn.
        this.#activity(
          this.look.toolStarted({
            description: event.description,
            command: commandOf(event.call),
          }),
        );
        break;

      case 'tool_batch':
        this.#batchSize = event.calls.length;
        if (this.#batchSize > 1) this.#activity(this.look.parallel(this.#batchSize));
        break;
      case 'tool_result':
        this.#toolResult(event);
        break;
      case 'task_running':
        this.#activity(
          this.look.taskRunning({ label: this.#label(event.description), id: event.task.id }),
        );
        break;
      case 'task_completed':
        this.#taskCompleted(event);
        break;
      case 'message_received':
        this.#activity(this.look.steer(firstLine(event.message.content)));
        break;
      case 'context_added':
        this.#activity(this.look.contextAdded({ hook: event.hook, chars: event.content.length }));
        break;
      case 'hook_failed':
        this.#activity(
          this.look.hookFailed({
            hook: event.hook,
            handler: event.handler,
            error: event.error,
          }),
        );
        break;
      case 'turn_end':
        this.#activity(
          this.look.turnEnd({ stopReason: event.stopReason, waiting: this.runningTasks() }),
        );
        break;
      case 'done':
        this.#done(event);
        break;
    }
  }

  /** One session update: sub-agents starting, reporting status, getting messages, ending. */
  session(update: SessionUpdate): void {
    const { type, session } = update;

    // The main session is not a card: only a sub-agent, which has a parent, is drawn.
    if (!('parentId' in session)) return;
    const agent = {
      indent: '  '.repeat(session.depth - 1),
      title: session.title,
      id: session.id,
    };

    if (type === 'session_started') {
      this.#activity(
        this.look.subAgentStarted({
          ...agent,
          depth: session.depth,
          parent: session.parentId,
          root: session.rootId,
        }),
      );
    }

    if (type === 'session_status') {
      this.#activity(this.look.subAgentStatus({ ...agent, status: session.status ?? '' }));
    }

    if (type === 'session_message') {
      const from = update.message.from === 'user' ? 'the user' : shortId(update.message.from);
      const content = firstLine(update.message.content);

      this.#activity(this.look.subAgentMessage({ ...agent, from, content }));
    }

    if (type === 'session_ended') {
      this.#activity(this.look.subAgentEnded({ ...agent, state: session.state }));
    }
  }

  /** The model's reply, as it streams: a section of its own, apart from what the run did. */
  #reply(text: string): void {
    if (text === '') return;
    this.#enter('reply');
    this.reply.write(text);
    this.#lineOpen = !text.endsWith('\n');
  }

  /** One thing the run did; `''` is a look choosing to show nothing. */
  #activity(text: string): void {
    if (text === '') return;
    this.#enter('activity');
    this.write(text);
    this.#lineOpen = false;
  }

  #enter(section: Section): void {
    const gap = this.look.gap({ from: this.#last, to: section, lineOpen: this.#lineOpen });

    // An empty write is not a pause in a reply: a screen ends the reply on any other output.
    if (gap !== '') this.write(gap);
    this.#last = section;
  }

  /** The prompt is over: the next one starts a fresh layout, not a gap after this one's text. */
  #done(event: EventOf<'done'>): void {
    this.reply.end();
    this.#activity(
      this.look.done({
        reason: event.reason,
        events: event.seq + 1,
        reasoning: this.#reasoningItems,
      }),
    );
    this.#last = undefined;
    this.#lineOpen = false;
  }

  #label(description: string): string {
    return this.#batchSize > 1 ? `${description} · ` : '';
  }

  #toolResult(event: EventOf<'tool_result'>): void {
    const { message, description, durationMs, artifacts = [] } = event;

    if (message.role !== 'tool') return;
    // A real UI would render a change's `before` / `after` as a diff; this just names it.
    const changed = artifacts.some(isFileChange);
    const read = artifacts.find(isFileRead);
    const summary = changed ? message.content : `${message.content.length} chars`;
    const detail = message.isError
      ? firstLine(message.content)
      : ((read && describeRead(read)) ?? summary);

    this.#activity(
      this.look.toolResult({
        ok: !message.isError,
        label: this.#label(description),
        detail,
        seconds: seconds(durationMs),
      }),
    );
  }

  #taskCompleted({ task }: EventOf<'task_completed'>): void {
    this.#activity(
      this.look.taskCompleted({
        ok: task.status === 'completed',
        id: task.id,
        status: task.status,
        exit: task.exitCode === undefined ? '' : ` · exit ${task.exitCode ?? '?'}`,
        elapsed: seconds((task.endedAt ?? now()) - task.startedAt),
        command: task.command,
        output: firstLine(task.error ?? task.output.split('\n').filter(Boolean).at(-1) ?? ''),
      }),
    );
  }
}
