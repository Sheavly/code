import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { WorkbookStore } from './store.service.js';
import type { RunId } from './workbook.types.js';
import { describeEvent, diffResults, mergeTextDeltas, toolsUsed } from './workbook.utils.js';
import { WorkbookNotFoundError } from '../errors/workbook.errors.js';
import type { Write } from '../render/render.types.js';

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
  id: RunId;
  write: Write;
}): Promise<void> {
  const { store, id, write } = params;
  const [meta, result, events, answer] = await Promise.all([
    store.metaIfThere(id),
    store.result(id),
    store.events(id),
    store.answer(id),
  ]);
  const paths = store.paths(id);
  const tools = toolsUsed(events);

  write(`Run ${id}\n`);

  if (meta) {
    write(`  prompt     ${meta.prompt}${meta.continues ? ` (continues ${meta.continues})` : ''}\n`);
    write(`  text       ${meta.text}\n`);
    write(`  model      ${meta.adapter} / ${meta.model}\n`);
    write(`  workspace  ${meta.workspace}\n`);
    write(
      `  started    ${DateTime.fromMillis(meta.startedAt).toFormat('yyyy-LL-dd HH:mm:ss')}${meta.gitCommit ? ` · commit ${meta.gitCommit}` : ''}\n`,
    );
  } else {
    // A force quit before the conversation opened: only what was recorded by then is there.
    write('  no run.json: the run ended before it started its conversation\n');
  }

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
  write(`\n  answer     ${answer || '(none)'}\n`);
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
  id: RunId;
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
  a: RunId;
  b: RunId;
  write: Write;
}): Promise<void> {
  const { store, write } = params;
  const load = async (id: RunId) => {
    const [result, events, answer] = await Promise.all([
      store.result(id),
      store.events(id),
      store.answer(id),
    ]);

    if (!result) {
      throw new WorkbookNotFoundError({
        wanted: id,
        message: `Run ${id} didn't finish, so there's nothing to compare`,
      });
    }

    return { id, result, tools: toolsUsed(events), answer };
  };
  const [a, b] = await Promise.all([load(params.a), load(params.b)]);

  write(`${a.id} → ${b.id}\n`);

  for (const line of diffResults({ a, b })) write(`  ${line}\n`);
}
