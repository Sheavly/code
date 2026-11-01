/**
 * Quick manual check: a real model call through the adapter registry, with read_file.
 *
 *   npx tsx src/demo.ts "Read package.json and tell me the project name"
 *
 * Reads settings from the environment (or from .env if present).
 * ADAPTER picks the backend: "openai" (default) or "azure".
 * WORKSPACE_ROOT confines file tools to a directory (default: current directory).
 * RUN_COMMAND_SKIP_ALLOW_LIST=true lets run_command run any shell command (default: allow list on).
 * This calls the real API and costs money (a fraction of a cent for a short prompt).
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { ToolCall } from '@sheavly/core/message/message.types';
import { streamAgent } from './loop/stream-agent/stream-agent.service.js';
import { DEFAULT_ADAPTER, DEFAULT_MODEL } from './providers/adapters/adapters.constants.js';
import { createDefaultRegistry } from './providers/adapters/adapters.service.js';
import { TaskRegistry } from './runtime/tasks/tasks.service.js';
import { loadProjectHooks } from './runtime/project-hooks/project-hooks.service.js';
import { Workspace } from './runtime/workspace/workspace.service.js';
import { createReadFileTool } from './tools/read-file/read-file.tool.js';
import { createWriteFileTool } from './tools/write-file/write-file.tool.js';
import { createEditFileTool } from './tools/edit-file/edit-file.tool.js';
import { createRunCommandTool } from './tools/run-command/run-command.tool.js';
import { createTaskTools } from './tools/tasks/tasks.tool.js';

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
const provider =
  env.ADAPTER === 'azure'
    ? registry.create('azure', {
        apiKey: env.AZURE_OPENAI_API_KEY,
        baseUrl: env.AZURE_OPENAI_BASE_URL,
        deployment: env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: env.AZURE_OPENAI_API_VERSION,
      })
    : registry.create('openai', { apiKey: env.OPENAI_API_KEY, model: env.MODEL });

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

/** Size of the current batch, so results are labeled only when there's more than one. */
let batchSize = 0;
let reasoningItems = 0;

/** Background commands (`run_command` with background: true), checked with task_status / cancel_task. */
const tasks = new TaskRegistry();

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
    createReadFileTool({ workspace }),
    createWriteFileTool({ workspace }),
    createEditFileTool({ workspace }),
    createRunCommandTool({ workspace, skipAllowList, tasks }),
    ...createTaskTools(tasks),
  ],
  messages: [{ role: 'user', content: prompt }],
  maxTurns: 10,
  signal: interrupt.signal,
  tasks,
  // The demo passes no hooks of its own; the project's run inside any it would.
  hooks: projectHooks,
  // A one-shot demo: stay around to show background completions (Ctrl+C stops waiting).
  waitForTasks: true,
});

// Events arrive in causal order with contiguous `seq` numbers, so rendering is a plain loop.
for await (const event of events) {
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

      process.stdout.write(`\n⏺ ${event.description}${command ? `  $ ${command}` : ''}`);
      break;
    }

    case 'tool_batch':
      batchSize = event.calls.length;
      process.stdout.write(batchSize > 1 ? `\n  ⎿ ${batchSize} tools in parallel\n` : '\n');
      break;

    case 'tool_result': {
      const { message, description, durationMs, change } = event;

      if (message.role !== 'tool') break;
      const label = batchSize > 1 ? `${description} · ` : '';
      // A real UI would render `change.before` / `change.after` as a diff; the demo just names it.
      const summary = change ? message.content : `${message.content.length} chars`;
      const detail = message.isError ? firstLine(message.content) : summary;

      process.stdout.write(
        `    ${message.isError ? '✗' : '✓'} ${label}${detail} · ${seconds(durationMs)}\n`,
      );
      break;
    }

    case 'task_running': {
      const label = batchSize > 1 ? `${event.description} · ` : '';

      process.stdout.write(`    ↻ ${label}running in background as ${event.task.id}\n`);
      break;
    }

    case 'task_completed': {
      const { task } = event;
      const ok = task.status === 'completed';
      const exit = task.exitCode === undefined ? '' : ` · exit ${task.exitCode ?? '?'}`;
      const output = firstLine(task.error ?? task.output.split('\n').filter(Boolean).at(-1) ?? '');
      const elapsed = seconds((task.endedAt ?? Date.now()) - task.startedAt);

      process.stdout.write(
        `\n${ok ? '✓' : '✗'} ${task.id} ${task.status}${exit} · ${elapsed} · $ ${task.command}`,
      );
      process.stdout.write(output ? `\n  ⎿ ${output}\n` : '\n');
      break;
    }

    case 'context_added':
      process.stdout.write(`\n＋ ${event.hook} added context (${event.content.length} chars)\n`);
      break;

    case 'turn_end':
      if (event.stopReason !== 'tool_use') {
        process.stdout.write(`\n\n[stop: ${event.stopReason}]\n`);
      }

      if (event.stopReason === 'end_turn' && tasks.runningCount > 0) {
        process.stdout.write(
          `… waiting for ${tasks.runningCount} background task(s) · Ctrl+C to stop\n`,
        );
      }

      break;
    case 'done':
      console.log(
        `[${event.reason} · ${event.seq + 1} events · ${event.messages.length} messages · reasoning items kept: ${reasoningItems}]`,
      );
      break;
  }
}

// Background tasks outlive a run, but not the demo: stop whatever is left before exiting.
if (tasks.runningCount > 0) {
  console.log(`⏹ Stopping ${tasks.runningCount} background task(s)`);
  await tasks.cancelAll();
}

// Nothing else should be keeping the process alive; exit with the conventional code for Ctrl+C.
process.exitCode = interrupt.signal.aborted ? 130 : 0;
