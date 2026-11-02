import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { isFileChange } from '@sheavly/coding/files/files.utils';
import { isFileRead } from '@sheavly/coding/read-file/read-file.utils';
import type { Write } from './render.types.js';
import { commandOf, describeRead, firstLine, oneLine, seconds, shortId } from './render.utils.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { SessionUpdate } from '@sheavly/protocol/session/session.types';

type EventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

/**
 * The terminal front end of the demo and the workbook: one line (or block) per loop event, per
 * session update and (optionally) per model call, written to `write`. It only renders events the
 * harness emits; nothing in the harness depends on it. Kept stateful only for the current tool
 * batch size and the reasoning count.
 */
export class Renderer {
  #batchSize = 0;
  #reasoningItems = 0;

  constructor(
    private readonly write: Write,
    private readonly tasks: TaskRegistry,
  ) {}

  /** One loop event, from `streamAgent`. */
  event(event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta':
        this.write(event.text);
        break;
      case 'reasoning':
        this.#reasoningItems++; // opaque; resent to the model automatically
        break;

      case 'tool_call_started': {
        // Already running; its result is shown after the model's turn.
        const command = commandOf(event.call);

        this.write(`\n⏺ ${event.description}${command ? `  $ ${command}` : ''}\n`);
        break;
      }

      case 'tool_batch':
        this.#batchSize = event.calls.length;
        if (this.#batchSize > 1) this.write(`  ⎿ ${this.#batchSize} tools in parallel\n`);
        break;
      case 'tool_result':
        this.#toolResult(event);
        break;
      case 'task_running':
        this.write(
          `    ↻ ${this.#label(event.description)}running in background as ${event.task.id}\n`,
        );
        break;
      case 'task_completed':
        this.#taskCompleted(event);
        break;
      case 'message_received':
        this.write(`\n✉ steer: ${firstLine(event.message.content)}\n`);
        break;
      case 'context_added':
        this.write(`\n＋ ${event.hook} added context (${event.content.length} chars)\n`);
        break;
      case 'hook_failed':
        this.write(`\n✗ hook ${event.hook} failed in ${event.handler}: ${event.error}\n`);
        break;
      case 'turn_end':
        this.#turnEnd(event);
        break;
      case 'done':
        this.write(
          `[${event.reason} · ${event.seq + 1} events · ${event.messages.length} messages · reasoning items kept: ${this.#reasoningItems}]\n`,
        );
        break;
    }
  }

  /** One session update: sub-agents starting, reporting status, getting messages, ending. */
  session(update: SessionUpdate): void {
    const { type, session } = update;

    if (session.depth === 1) return;
    const indent = '  '.repeat(session.depth - 1);
    const who = `"${session.title}" [${shortId(session.id)}]`;

    if (type === 'session_started') {
      this.write(
        `\n${indent}◆ sub-agent ${who} started · depth ${session.depth} · parent ${shortId(session.parentId)} · main ${shortId(session.rootId)}\n`,
      );
    }

    if (type === 'session_status') {
      this.write(`${indent}  ◇ ${who} status: ${session.status ?? ''}\n`);
    }

    if (type === 'session_message') {
      const from = update.message.from === 'user' ? 'the user' : shortId(update.message.from);

      this.write(
        `${indent}  ✉ ${who} got a message from ${from}: ${firstLine(update.message.content)}\n`,
      );
    }

    if (type === 'session_ended') this.write(`${indent}◆ sub-agent ${who} ${session.state}\n`);
  }

  /** One model call: whose task, which tools, what system prompt, the latest user message. */
  modelCall(request: ProviderRequest): void {
    const task = request.messages.find((m) => m.role === 'user')?.content ?? '';
    const instructions = request.instructions ?? '';
    const latest = request.messages.findLast((m) => m.role === 'user')?.content ?? '';
    const prompt = instructions
      ? `${instructions.length} chars: "${oneLine({ text: instructions, max: 90 })}"`
      : 'none';

    this.write(
      `\n  · model call for "${oneLine({ text: task, max: 40 })}" · ${request.messages.length} messages\n` +
        `    tools: ${request.tools.map((tool) => tool.name).join(', ') || 'none'}\n` +
        `    system prompt: ${prompt}\n` +
        `    latest user message: "${oneLine({ text: latest, max: 110 })}"\n`,
    );
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

    this.write(
      `    ${message.isError ? '✗' : '✓'} ${this.#label(description)}${detail} · ${seconds(durationMs)}\n`,
    );
  }

  #taskCompleted({ task }: EventOf<'task_completed'>): void {
    const ok = task.status === 'completed';
    const exit = task.exitCode === undefined ? '' : ` · exit ${task.exitCode ?? '?'}`;
    const output = firstLine(task.error ?? task.output.split('\n').filter(Boolean).at(-1) ?? '');
    const elapsed = seconds((task.endedAt ?? Date.now()) - task.startedAt);

    this.write(
      `\n${ok ? '✓' : '✗'} ${task.id} ${task.status}${exit} · ${elapsed} · $ ${task.command}`,
    );
    this.write(output ? `\n  ⎿ ${output}\n` : '\n');
  }

  #turnEnd({ stopReason }: EventOf<'turn_end'>): void {
    if (stopReason !== 'tool_use') this.write(`\n\n[stop: ${stopReason}]\n`);

    if (stopReason === 'end_turn' && this.tasks.runningCount > 0) {
      this.write(`… waiting for ${this.tasks.runningCount} background task(s) · Ctrl+C to stop\n`);
    }
  }
}
