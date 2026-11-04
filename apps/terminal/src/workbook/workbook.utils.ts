import path from 'node:path';
import { firstLine, oneLine, shortId } from '../render/render.utils.js';
import { RUN_FILES } from './workbook.constants.js';
import type { Command, RunPaths, RunResult } from './workbook.types.js';
import type { EntryEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';

/** A prompt or fixture name is one file name in its folder (`write-and-edit`), never a path. */
export function isPlainName(name: string): boolean {
  return /^\w[\w.-]*$/.test(name);
}

/** `0007-write-and-edit`: the run number, then the prompt name, so runs sort in order. */
export function runId(params: { number: number; prompt: string }): string {
  const slug = params.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  return `${String(params.number).padStart(4, '0')}-${slug || 'run'}`;
}

/** Every file of a run, under `runsDir/<id>/`. */
export function runPaths(params: { runsDir: string; id: string }): RunPaths {
  const dir = path.join(params.runsDir, params.id);
  const files = Object.fromEntries(
    Object.entries(RUN_FILES).map(([key, file]) => [key, path.join(dir, file)]),
  ) as Omit<RunPaths, 'dir'>;

  return { dir, ...files };
}

// --- Command line ---

const USAGE = `Usage: npm run workbook -- <command>

  run <prompt>             run a stored prompt (workbook/prompts/<prompt>.md) in a fresh workspace
    --continue <run|last>  start from that run's history and workspace instead
    --keep                 reuse the prompt's last workspace instead of a fresh copy
  ask "<text>"             run a one-off prompt (saved like any other run)
  continue [run] "<text>"  send a follow-up to a run (default: the last one), with its history
  check [prompt…] [--all]  run the real-model checks: the named prompts, else the ones whose
                           areas this branch changed (--all: every one). Costs model calls.
  list                     every stored prompt, and the last runs
  show [run]               a run's summary, result and files (default: the last one)
  step [run] [--from N]    walk a run's events one at a time (Enter: next, q: quit)
  diff <run-a> <run-b>     compare two runs: outcome, counts, tools used, final answer

  --model-calls            also print every model call (tools, system prompt, latest message)
  --trust                  trust the workspace's .sheavly/ hooks (a fresh fixture copy already is)

Runs are saved in workbook/runs/<id>/ as they happen; "last" means the most recent run.`;

export function usage(): string {
  return USAGE;
}

/** The command line, parsed. Unknown commands show the usage instead of guessing. */
export function parseCommand(argv: string[]): Command {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag);

    return index === -1 ? undefined : argv[index + 1];
  };
  const flagValues = new Set([valueOf('--continue'), valueOf('--from')].filter(Boolean));
  const words = argv.filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
  const [name, ...rest] = words;
  const showModelCalls = flags.has('--model-calls');
  const trust = flags.has('--trust');

  switch (name) {
    case 'run':
      return rest[0]
        ? {
            name: 'run',
            prompt: rest[0],
            continueRun: valueOf('--continue'),
            fresh: !flags.has('--keep'),
            showModelCalls,
            trust,
          }
        : { name: 'help' };
    case 'ask':
      return rest.length > 0
        ? { name: 'ask', text: rest.join(' '), showModelCalls, trust }
        : { name: 'help' };
    case 'continue':
      // `continue "text"` (the last run) or `continue <run> "text"`.
      if (rest.length === 0) return { name: 'help' };

      return rest.length === 1
        ? { name: 'continue', text: rest[0] ?? '', showModelCalls, trust }
        : { name: 'continue', run: rest[0], text: rest.slice(1).join(' '), showModelCalls, trust };
    case 'check':
      return { name: 'check', prompts: rest, all: flags.has('--all') };
    case 'list':
      return { name: 'list' };
    case 'show':
      return { name: 'show', run: rest[0] };

    case 'step': {
      const from = valueOf('--from');

      return { name: 'step', run: rest[0], from: from === undefined ? undefined : Number(from) };
    }

    case 'diff':
      return rest[0] && rest[1] ? { name: 'diff', a: rest[0], b: rest[1] } : { name: 'help' };
    default:
      return { name: 'help' };
  }
}

// --- Inspecting runs ---

/** One event as a single readable line, for `step`. */
export function describeEvent(event: EntryEvent): string {
  const head = `#${String(event.seq).padStart(4, ' ')} ${event.type}`;

  switch (event.type) {
    case 'text_delta':
      return `${head}  "${oneLine({ text: event.text, max: 80 })}"`;
    case 'tool_call_started':
      return `${head}  ${event.call.name} · ${event.description} · ${oneLine({ text: JSON.stringify(event.call.input), max: 80 })}`;
    case 'tool_result':
      return `${head}  ${event.call.name} ${event.message.role === 'tool' && event.message.isError ? '✗' : '✓'} ${firstLine(event.message.content)}`;
    case 'task_running':
    case 'task_completed':
      return `${head}  ${event.task.id} ${event.task.status} · ${event.task.command}`;
    case 'message_received':
      return `${head}  from ${event.message.from === 'user' ? 'user' : shortId(event.message.from)}: ${firstLine(event.message.content)}`;
    case 'context_added':
      return `${head}  ${event.hook}: ${oneLine({ text: event.content, max: 80 })}`;
    case 'hook_failed':
      return `${head}  ${event.hook}.${event.handler}: ${firstLine(event.error)}`;
    case 'turn_end':
      return `${head}  turn ${event.turn} · ${event.stopReason}`;
    case 'done':
      return `${head}  ${event.reason} · session ${shortId(event.session.id)}`;
    default:
      return head;
  }
}

/**
 * Text deltas arrive a few characters at a time; for stepping, consecutive deltas are merged
 * into one event, so each step is something that happened.
 */
export function mergeTextDeltas(events: EntryEvent[]): EntryEvent[] {
  const merged: EntryEvent[] = [];

  for (const event of events) {
    const previous = merged.at(-1);

    if (event.type === 'text_delta' && previous?.type === 'text_delta') {
      merged[merged.length - 1] = { ...previous, text: previous.text + event.text };
    } else {
      merged.push(event);
    }
  }

  return merged;
}

/** What two runs did differently: one line per field that differs, or a note that none do. */
export function diffResults(params: {
  a: { id: string; result: RunResult; tools: string[]; answer: string };
  b: { id: string; result: RunResult; tools: string[]; answer: string };
}): string[] {
  const { a, b } = params;
  const lines: string[] = [];
  const fields = [
    'outcome',
    'events',
    'modelCalls',
    'toolCalls',
    'toolErrors',
    'sessions',
    'messages',
  ] as const;

  for (const field of fields) {
    if (a.result[field] !== b.result[field]) {
      lines.push(`${field}: ${String(a.result[field])} → ${String(b.result[field])}`);
    }
  }

  const duration = `${(a.result.durationMs / 1000).toFixed(1)}s → ${(b.result.durationMs / 1000).toFixed(1)}s`;

  lines.push(`duration: ${duration}`);

  const toolsA = a.tools.join(', ');
  const toolsB = b.tools.join(', ');

  if (toolsA !== toolsB) lines.push(`tools: ${toolsA || 'none'}\n    → ${toolsB || 'none'}`);

  if (a.answer.trim() === b.answer.trim()) {
    lines.push('answer: the same');
  } else {
    lines.push(
      `answer: "${oneLine({ text: a.answer, max: 100 })}"\n    → "${oneLine({ text: b.answer, max: 100 })}"`,
    );
  }

  return lines;
}

// --- Reading a saved run ---

/** Tool names in the order they were first called. */
export function toolsUsed(events: EntryEvent[]): string[] {
  const names = events.filter((e) => e.type === 'tool_call_started').map((e) => e.call.name);

  return [...new Set(names)];
}

/** The text of the last assistant reply in a conversation. */
export function finalAnswer(messages: Message[]): string {
  return messages.findLast((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';
}
