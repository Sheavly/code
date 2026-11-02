import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import type { AgentEvent } from '../loop/events/events.types.js';
import type { WorkbookStore } from './store.service.js';
import { describeEvent, diffResults, mergeTextDeltas } from './workbook.utils.js';
import { WorkbookNotFoundError } from '../runtime/errors/workbook.errors.js';

type Write = (text: string) => void;

/** `list`: the stored prompts, and the latest runs with how they ended. */
export async function listWorkbook(params: { store: WorkbookStore; write: Write }): Promise<void> {
  const { store, write } = params;
  const [prompts, state, runs] = await Promise.all([
    store.prompts(),
    store.state(),
    store.runIds(),
  ]);

  write(`Stored prompts (${store.promptsDir}):\n`);

  for (const prompt of prompts) {
    const last = state.lastRunByPrompt[prompt.name];

    write(
      `  ${prompt.name.padEnd(24)} ${prompt.description ?? ''}${last ? `  · last run ${last}` : ''}\n`,
    );
  }

  write(`\nRuns (${runs.length}, latest last):\n`);

  for (const id of runs.slice(-10)) {
    const result = await store.result(id);
    const status = result
      ? `${result.outcome} · ${(result.durationMs / 1000).toFixed(1)}s`
      : 'unfinished';

    write(`  ${id.padEnd(40)} ${status}${result?.error ? ` · ${result.error}` : ''}\n`);
  }
}

/** `show`: one run's summary: what it was, how it ended, and where its files are. */
export async function showRun(params: {
  store: WorkbookStore;
  id: string;
  write: Write;
}): Promise<void> {
  const { store, id, write } = params;
  const [meta, result, events] = await Promise.all([
    store.meta(id),
    store.result(id),
    store.events(id),
  ]);
  const paths = store.paths(id);
  const tools = toolsUsed(events);

  write(`Run ${id}\n`);
  write(`  prompt     ${meta.prompt}${meta.continues ? ` (continues ${meta.continues})` : ''}\n`);
  write(`  text       ${meta.text}\n`);
  write(`  model      ${meta.adapter} / ${meta.model}\n`);
  write(`  workspace  ${meta.workspace}\n`);
  write(`  started    ${meta.startedAt}${meta.gitCommit ? ` · commit ${meta.gitCommit}` : ''}\n`);

  if (result) {
    write(`  outcome    ${result.outcome}${result.error ? ` · ${result.error}` : ''}\n`);
    write(
      `  counts     ${result.events} events · ${result.modelCalls} model calls · ${result.toolCalls} tool calls (${result.toolErrors} failed) · ${result.sessions} sessions\n`,
    );
    write(
      `  duration   ${(result.durationMs / 1000).toFixed(1)}s · last event ${result.lastEvent ?? '-'}\n`,
    );
  } else {
    write(
      `  outcome    unfinished: no result.json (crashed or still running). Last event: ${events.at(-1)?.type ?? 'none'}\n`,
    );
  }

  write(`  tools      ${tools.join(', ') || 'none'}\n`);
  write(`\n  answer     ${finalAnswer(events) || '(none)'}\n`);
  write(`\nFiles (${path.relative(process.cwd(), paths.dir)}/):\n`);

  for (const [key, file] of Object.entries(paths)) {
    if (key !== 'dir') write(`  ${path.basename(file)}\n`);
  }

  write(`\nStep through it: npm run workbook -- step ${id}\n`);
}

/**
 * `step`: walks a run's events one at a time (text deltas merged). Enter shows the next, a
 * number jumps to that event, `j` prints the current event's full JSON, `q` quits. Without a
 * terminal (piped), prints every event.
 */
export async function stepRun(params: {
  store: WorkbookStore;
  id: string;
  from?: number | undefined;
  write: Write;
}): Promise<void> {
  const { store, id, from = 0, write } = params;
  const events = mergeTextDeltas(await store.events(id)).filter((event) => event.seq >= from);

  write(
    `Run ${id}: ${events.length} steps. Enter: next · <number>: jump to that seq · j: full JSON · q: quit\n\n`,
  );

  if (!process.stdin.isTTY) {
    for (const event of events) write(`${describeEvent(event)}\n`);

    return;
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let index = 0;

  try {
    while (index < events.length) {
      const event = events[index];

      if (!event) break;
      write(`${describeEvent(event)}\n`);
      const answer = (await prompt.question('  › ')).trim();

      if (answer === 'q') break;

      if (answer === 'j') {
        write(`${JSON.stringify(event, null, 2)}\n`);
        continue;
      }

      const jump = /^\d+$/.test(answer) ? events.findIndex((e) => e.seq >= Number(answer)) : -1;

      index = jump === -1 ? index + 1 : jump;
    }
  } finally {
    prompt.close();
  }
}

/** `diff`: how two runs differ: outcome, counts, tools used, and the final answer. */
export async function diffRuns(params: {
  store: WorkbookStore;
  a: string;
  b: string;
  write: Write;
}): Promise<void> {
  const { store, write } = params;
  const load = async (id: string) => {
    const [result, events] = await Promise.all([store.result(id), store.events(id)]);

    if (!result) {
      throw new WorkbookNotFoundError({
        wanted: id,
        message: `Run ${id} didn't finish, so there's nothing to compare`,
      });
    }

    return { id, result, tools: toolsUsed(events), answer: finalAnswer(events) };
  };
  const [a, b] = await Promise.all([load(params.a), load(params.b)]);

  write(`${a.id} → ${b.id}\n`);

  for (const line of diffResults({ a, b })) write(`  ${line}\n`);
}

/** Tool names in the order they were first called. */
function toolsUsed(events: AgentEvent[]): string[] {
  const names = events.filter((e) => e.type === 'tool_call_started').map((e) => e.call.name);

  return [...new Set(names)];
}

/** The text of the main session's last reply. */
function finalAnswer(events: AgentEvent[]): string {
  const done = events.findLast((e) => e.type === 'done');

  if (done?.type !== 'done') return '';

  return done.messages.findLast((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';
}
