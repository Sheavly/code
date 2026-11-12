/**
 * The workbook: a stateful place to run, replay and inspect the harness.
 *
 *   npm run workbook -- run write-and-edit      run a stored prompt (workbook/prompts/*.md)
 *   npm run workbook -- continue "and now…"     follow up on the last run, with its history
 *   npm run workbook -- show                    what the last run did, and where its files are
 *   npm run workbook -- step                    walk its events one at a time
 *   npm run workbook -- diff 0003 0007          compare two runs
 *   npm run workbook -- check                   real-model checks for what this branch changed
 *
 * Every run is saved in workbook/runs/<id>/ as it happens. See apps/terminal/docs/workbook.md.
 * Each run starts its own backend, which runs on the models in the user's profile (~/.sheavly),
 * like the demo: the profile's own choice, or `--model` / `WORKBOOK_MODEL` for this run only.
 */
import path from 'node:path';
import { checkWorkbook } from './check.helper.js';
import { diffRuns, listWorkbook, showRun, stepRun } from './inspect.helper.js';
import { runWorkbook } from './run.helper.js';
import { WorkbookStore } from './store.service.js';
import { WORKBOOK_DIR } from './workbook.constants.js';
import { parseCommand, usage, workbookModel } from './workbook.utils.js';

const store = new WorkbookStore(path.resolve(WORKBOOK_DIR));
const write = (text: string) => void process.stdout.write(text);
const command = parseCommand(process.argv.slice(2));
const modelFor = (parsed: { model?: string | undefined }) =>
  workbookModel({ flag: parsed.model, env: process.env });

try {
  switch (command.name) {
    case 'run': {
      const stored = await store.prompt(command.prompt);
      const continues =
        command.continueRun === undefined ? undefined : await store.resolveRun(command.continueRun);
      const result = await runWorkbook({
        store,
        request: {
          name: stored.name,
          text: stored.text,
          stored,
          continues,
          keep: !command.fresh,
          showModelCalls: command.showModelCalls,
          trust: command.trust,
          model: modelFor(command),
        },
      });

      process.exitCode = exitCode(result.outcome);
      break;
    }

    case 'ask': {
      const result = await runWorkbook({
        store,
        request: {
          name: 'ask',
          text: command.text,
          keep: false,
          showModelCalls: command.showModelCalls,
          trust: command.trust,
          model: modelFor(command),
        },
      });

      process.exitCode = exitCode(result.outcome);
      break;
    }

    case 'continue': {
      const continues = await store.resolveRun(command.run);
      const meta = await store.meta(continues);
      const result = await runWorkbook({
        store,
        request: {
          name: meta.prompt,
          text: command.text,
          continues,
          keep: true,
          showModelCalls: command.showModelCalls,
          trust: command.trust,
          model: modelFor(command),
        },
      });

      process.exitCode = exitCode(result.outcome);
      break;
    }

    case 'check': {
      const passed = await checkWorkbook({
        store,
        names: command.prompts,
        all: command.all,
        approvedCommands: command.approvedCommands,
        model: modelFor(command),
        write,
      });

      process.exitCode = passed ? 0 : 1;
      break;
    }

    case 'list':
      await listWorkbook({ store, write });
      break;
    case 'show':
      await showRun({ store, id: await store.resolveRun(command.run), write });
      break;
    case 'step':
      await stepRun({ store, id: await store.resolveRun(command.run), from: command.from, write });
      break;
    case 'diff':
      await diffRuns({
        store,
        a: await store.resolveRun(command.a),
        b: await store.resolveRun(command.b),
        write,
      });
      break;
    case 'help':
      write(`${usage()}\n`);
      break;
  }
} catch (caughtError) {
  write(`✗ ${caughtError instanceof Error ? caughtError.message : String(caughtError)}\n`);
  process.exitCode = 1;
}

/** 0 completed, 130 interrupted (like Ctrl+C), 1 anything else. */
function exitCode(outcome: string): number {
  if (outcome === 'completed') return 0;

  return outcome === 'interrupted' ? 130 : 1;
}
