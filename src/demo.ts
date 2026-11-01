/**
 * Quick manual check: a real model call through the adapter registry, with read_file.
 *
 *   npx tsx src/demo.ts "Read package.json and tell me the project name"
 *
 * Reads settings from the environment (or from .env if present).
 * ADAPTER picks the backend: "openai" (default) or "azure".
 * WORKSPACE_ROOT confines file tools to a directory (default: current directory).
 * RUN_COMMAND_SKIP_ALLOW_LIST=true lets run_command run any shell command (default: allow list on).
 * SHOW_MODEL_CALLS=true prints every model call (main session and sub-agents): its task, tools
 *   and system instructions.
 * SESSIONS_SSE_LOG=<file> writes the session registry's server-sent event stream to a file.
 * This calls the real API and costs money (a fraction of a cent for a short prompt).
 */
import { createWriteStream, existsSync } from 'node:fs';
import { Writable } from 'node:stream';
import { z } from 'zod';
import type { ToolCall } from '@sheavly/core/message/message.types';
import type { AgentEvent } from './loop/events/events.types.js';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runSession, streamAgent } from './loop/stream-agent/stream-agent.service.js';
import { DEFAULT_ADAPTER, DEFAULT_MODEL } from './providers/adapters/adapters.constants.js';
import { createDefaultRegistry } from './providers/adapters/adapters.service.js';
import { TaskRegistry } from './runtime/tasks/tasks.service.js';
import { SessionRegistry } from './runtime/sessions/sessions.service.js';
import { loadProjectHooks } from './runtime/project-hooks/project-hooks.service.js';
import { createAgentsMdHook } from './runtime/agents-md/agents-md.service.js';
import { Workspace } from './runtime/workspace/workspace.service.js';
import { createReadFileTool } from './tools/read-file/read-file.tool.js';
import { createWriteFileTool } from './tools/write-file/write-file.tool.js';
import { createEditFileTool } from './tools/edit-file/edit-file.tool.js';
import { createRunCommandTool } from './tools/run-command/run-command.tool.js';
import { createTaskTools } from './tools/tasks/tasks.tool.js';
import { createSubAgentTool } from './tools/sub-agent/sub-agent.tool.js';
import { createMessageAgentTool } from './tools/sub-agent/message-agent.tool.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const Env = z.discriminatedUnion('ADAPTER', [
  z.object({
    ADAPTER: z.literal('openai'),
    OPENAI_API_KEY: z.string().min(1, 'Set OPENAI_API_KEY'),
    MODEL: z.string().default(DEFAULT_MODEL),
  }),
  z.object({
    ADAPTER: z.literal('azure'),
    AZURE_OPENAI_API_KEY: z.string().min(1, 'Set AZURE_OPENAI_API_KEY'),
    AZURE_OPENAI_BASE_URL: z.string().min(1, 'Set AZURE_OPENAI_BASE_URL'),
    AZURE_OPENAI_DEPLOYMENT: z.string().default(DEFAULT_MODEL),
    AZURE_OPENAI_API_VERSION: z
      .string()
      .optional()
      .transform((v) => (v === '' ? undefined : v)), // an empty line in .env means "not set"
  }),
]);

const env = Env.parse({ ...process.env, ADAPTER: process.env.ADAPTER ?? DEFAULT_ADAPTER });

const registry = createDefaultRegistry();
const backend =
  env.ADAPTER === 'azure'
    ? registry.create('azure', {
        apiKey: env.AZURE_OPENAI_API_KEY,
        baseUrl: env.AZURE_OPENAI_BASE_URL,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
      })
    : registry.create('openai', { apiKey: env.OPENAI_API_KEY, model: env.MODEL });

/** Only the exact string "true" turns these on. */
const showModelCalls = process.env.SHOW_MODEL_CALLS === 'true';
const oneLine = (params: { text: string; max: number }) => {
  const { text, max } = params;
  const flat = text.replace(/\s+/g, ' ').trim();

  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/** With SHOW_MODEL_CALLS, every model call is printed first: whose task, which tools, what system prompt. */
const provider: Provider = showModelCalls
  ? {
      stream: (request) => {
        const task = request.messages.find((m) => m.role === 'user')?.content ?? '';
        const instructions = request.instructions ?? '';
        const latest = request.messages.findLast((m) => m.role === 'user')?.content ?? '';

        process.stdout.write(
          `\n  · model call for "${oneLine({ text: task, max: 40 })}" · ${request.messages.length} messages\n` +
            `    tools: ${request.tools.map((tool) => tool.name).join(', ') || 'none'}\n` +
            `    system prompt: ${instructions ? `${instructions.length} chars: "${oneLine({ text: instructions, max: 90 })}"` : 'none'}\n` +
            `    latest user message: "${oneLine({ text: latest, max: 110 })}"\n`,
        );

        return backend.stream(request);
      },
    }
  : backend;

const model = env.ADAPTER === 'azure' ? env.AZURE_OPENAI_DEPLOYMENT : env.MODEL;
const prompt = process.argv.slice(2).join(' ') || 'Read package.json and tell me the project name.';

const workspaceRoot = z
  .string()
  .min(1)
  .optional()
  .parse(process.env.WORKSPACE_ROOT === '' ? undefined : process.env.WORKSPACE_ROOT);
const workspace = await Workspace.open(workspaceRoot);
/** `.sheavly/hooks.json` in the workspace, loaded once. A broken hook stops the demo here. */
const projectHooks = await loadProjectHooks({ root: workspace.root });

/** Only the exact string "true" turns the allow list off. */
const skipAllowList = process.env.RUN_COMMAND_SKIP_ALLOW_LIST === 'true';

console.log(`→ ${env.ADAPTER} / ${model} in ${workspace.root}`);
if (skipAllowList) console.log('⚠ run_command allow list is OFF: any shell command can run');

if (projectHooks.length > 0) {
  console.log(`→ hooks from .sheavly: ${projectHooks.map((hook) => hook.name).join(', ')}`);
}

console.log(`→ ${prompt}\n`);

const commandOf = (call: ToolCall) => {
  const input = z.object({ command: z.string() }).safeParse(call.input);

  return call.name === 'run_command' && input.success ? input.data.command : undefined;
};
const firstLine = (text: string) => {
  const max = 100;
  const line = text.split('\n').find((l) => l.trim()) ?? '';

  return line.length > max ? `${line.slice(0, max)}…` : line;
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Model calls per session (main and each sub-agent): room for multi-step sub-agent work. */
const DEMO_MAX_TURNS = 20;

/** Size of the current batch, so results are labeled only when there's more than one. */
let batchSize = 0;
let reasoningItems = 0;

/** Background commands (`run_command` with background: true), checked with task_status / cancel_task. */
const tasks = new TaskRegistry();

/**
 * Every session of this run: the main one and its sub-agents. Sub-agents report their own
 * status; a UI would read `sessions.stream()` (server-sent events), the demo just prints them.
 */
const sessions = new SessionRegistry();
const mainSession = sessions.startMain({ title: prompt.slice(0, 60) });
/** Session ids are UUIDs; the first 8 characters are plenty to tell them apart on screen. */
const short = (id: string | undefined) => (id ? id.slice(0, 8) : '-');

console.log(`→ main session ${short(mainSession.id)}`);

sessions.subscribe((update) => {
  const { type, session } = update;

  if (session.depth === 1) return;
  const indent = '  '.repeat(session.depth - 1);
  const who = `"${session.title}" [${short(session.id)}]`;

  if (type === 'session_started') {
    process.stdout.write(
      `\n${indent}◆ sub-agent ${who} started · depth ${session.depth} · parent ${short(session.parentId)} · main ${short(session.rootId)}\n`,
    );
  }

  if (type === 'session_status') {
    process.stdout.write(`${indent}  ◇ ${who} status: ${session.status ?? ''}\n`);
  }

  if (type === 'session_message') {
    process.stdout.write(
      `${indent}  ✉ ${who} got a message from ${update.message.from === 'user' ? 'the user' : short(update.message.from)}: ${firstLine(update.message.content)}\n`,
    );
  }

  if (type === 'session_ended') {
    process.stdout.write(`${indent}◆ sub-agent ${who} ${session.state}\n`);
  }
});

/** With SESSIONS_SSE_LOG, the registry's real SSE stream (what a UI would read) goes to a file. */
const sseLog = process.env.SESSIONS_SSE_LOG;
const stopSse = new AbortController();
const sseWritten = sseLog
  ? sessions
      .stream({ signal: stopSse.signal })
      .pipeTo(Writable.toWeb(createWriteStream(sseLog)) as WritableStream<Uint8Array>)
  : Promise.resolve();

/** The file tools, shared by the main session and every sub-agent. */
const fileTools = [
  createReadFileTool({ workspace }),
  createWriteFileTool({ workspace }),
  createEditFileTool({ workspace }),
];

// Ctrl+C once: stop the turn cleanly (tools killed, partial history kept). Twice: force quit.
// Commands run in their own process groups, so run_command kills them on exit either way.
const interrupt = new AbortController();
/**
 * Under `npx tsx`, one Ctrl+C reaches node twice (from the terminal, and relayed by tsx), so a
 * second SIGINT this soon is the same keypress, not a request to force quit.
 */
const SAME_KEYPRESS_MS = 500;
let interruptedAt = 0;

process.on('SIGINT', () => {
  if (interrupt.signal.aborted) {
    if (Date.now() - interruptedAt < SAME_KEYPRESS_MS) return;
    process.stdout.write('\n✗ Forced exit.\n');
    process.exit(130);
  }

  interruptedAt = Date.now();
  process.stdout.write('\n⏹ Interrupting… (Ctrl+C again to force quit)\n');
  interrupt.abort();
});

const events = streamAgent({
  provider,
  tools: [
    ...fileTools,
    createRunCommandTool({ workspace, skipAllowList, tasks }),
    ...createTaskTools(tasks),
    // Sub-agents get the file tools and the AGENTS.md hook (not the .sheavly hooks).
    createSubAgentTool({
      sessions,
      tasks,
      provider,
      runAgent: runSession,
      tools: fileTools,
      hooks: [createAgentsMdHook({ root: workspace.root })],
      maxTurns: DEMO_MAX_TURNS,
    }),
    createMessageAgentTool({ sessions }),
  ],
  messages: [{ role: 'user', content: prompt }],
  maxTurns: DEMO_MAX_TURNS,
  signal: interrupt.signal,
  tasks,
  session: { registry: sessions, ref: mainSession },
  // Host hooks first (outermost), then the project's: AGENTS.md from the workspace root down.
  hooks: [createAgentsMdHook({ root: workspace.root }), ...projectHooks],
  // A one-shot demo: stay around to show background completions (Ctrl+C stops waiting).
  waitForTasks: true,
});

type EventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

function renderToolResult(event: EventOf<'tool_result'>): void {
  const { message, description, durationMs, change } = event;

  if (message.role !== 'tool') return;
  const label = batchSize > 1 ? `${description} · ` : '';
  // A real UI would render `change.before` / `change.after` as a diff; the demo just names it.
  const summary = change ? message.content : `${message.content.length} chars`;
  const detail = message.isError ? firstLine(message.content) : summary;

  process.stdout.write(
    `    ${message.isError ? '✗' : '✓'} ${label}${detail} · ${seconds(durationMs)}\n`,
  );
}

function renderTaskCompleted({ task }: EventOf<'task_completed'>): void {
  const ok = task.status === 'completed';
  const exit = task.exitCode === undefined ? '' : ` · exit ${task.exitCode ?? '?'}`;
  const output = firstLine(task.error ?? task.output.split('\n').filter(Boolean).at(-1) ?? '');
  const elapsed = seconds((task.endedAt ?? Date.now()) - task.startedAt);

  process.stdout.write(
    `\n${ok ? '✓' : '✗'} ${task.id} ${task.status}${exit} · ${elapsed} · $ ${task.command}`,
  );
  process.stdout.write(output ? `\n  ⎿ ${output}\n` : '\n');
}

function renderTurnEnd({ stopReason }: EventOf<'turn_end'>): void {
  if (stopReason !== 'tool_use') process.stdout.write(`\n\n[stop: ${stopReason}]\n`);

  if (stopReason === 'end_turn' && tasks.runningCount > 0) {
    process.stdout.write(
      `… waiting for ${tasks.runningCount} background task(s) · Ctrl+C to stop\n`,
    );
  }
}

/** Prints one loop event: the demo's whole UI. */
function render(event: AgentEvent): void {
  switch (event.type) {
    case 'text_delta':
      process.stdout.write(event.text);
      break;
    case 'reasoning':
      reasoningItems++; // opaque; resent to the model automatically
      break;

    case 'tool_call_started': {
      // Already running in the background; its result is shown after the model's turn.
      const command = commandOf(event.call);

      process.stdout.write(`\n⏺ ${event.description}${command ? `  $ ${command}` : ''}\n`);
      break;
    }

    case 'tool_batch':
      batchSize = event.calls.length;
      if (batchSize > 1) process.stdout.write(`  ⎿ ${batchSize} tools in parallel\n`);
      break;
    case 'tool_result':
      renderToolResult(event);
      break;
    case 'task_running':
      process.stdout.write(
        `    ↻ ${batchSize > 1 ? `${event.description} · ` : ''}running in background as ${event.task.id}\n`,
      );
      break;
    case 'task_completed':
      renderTaskCompleted(event);
      break;
    case 'message_received':
      process.stdout.write(`\n✉ steer: ${firstLine(event.message.content)}\n`);
      break;
    case 'context_added':
      process.stdout.write(`\n＋ ${event.hook} added context (${event.content.length} chars)\n`);
      break;
    case 'turn_end':
      renderTurnEnd(event);
      break;
    case 'done':
      console.log(
        `[${event.reason} · ${event.seq + 1} events · ${event.messages.length} messages · reasoning items kept: ${reasoningItems}]`,
      );
      break;
  }
}

// Events arrive in causal order with contiguous `seq` numbers, so rendering is a plain loop.
/** Set when the run fails (a provider error, a hook throwing): shown once, then exit code 1. */
let failure: string | undefined;

try {
  for await (const event of events) render(event);
} catch (caughtError) {
  failure = caughtError instanceof Error ? caughtError.message : String(caughtError);
  process.stdout.write(`\n✗ Run failed: ${failure}\n`);
}

// Background tasks outlive a run, but not the demo: stop whatever is left before exiting.
if (tasks.runningCount > 0) {
  console.log(`⏹ Stopping ${tasks.runningCount} background task(s)`);
  await tasks.cancelAll();
}

stopSse.abort();
await sseWritten;

// Nothing else should be keeping the process alive; exit with the conventional code for Ctrl+C.
const interrupted = interrupt.signal.aborted ? 130 : 0;

process.exitCode = failure ? 1 : interrupted;
