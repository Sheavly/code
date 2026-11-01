import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Message } from '@sheavly/core/message/message.types';
import type { AgentEvent } from '../loop/events/events.types.js';
import {
  EMPTY_STATE,
  FAKE_ENV,
  PROMPTS_DIR,
  RUNS_DIR,
  STATE_FILE,
  WORKSPACES_DIR,
} from './workbook.constants.js';
import type {
  RunMeta,
  RunPaths,
  RunResult,
  StoredPrompt,
  WorkbookState,
} from './workbook.types.js';
import {
  parsePromptFile,
  runMetaSchema,
  runPaths,
  runResultSchema,
  stateSchema,
} from './workbook.utils.js';

/**
 * The workbook folder: stored prompts (`prompts/`), fixture and run workspaces
 * (`workspaces/`), saved runs (`runs/`) and what it remembers between runs (`state.json`).
 * Everything read back from disk is validated.
 */
export class WorkbookStore {
  readonly promptsDir: string;
  readonly runsDir: string;
  readonly workspacesDir: string;
  readonly #stateFile: string;

  constructor(readonly root: string) {
    this.promptsDir = path.join(root, PROMPTS_DIR);
    this.runsDir = path.join(root, RUNS_DIR);
    this.workspacesDir = path.join(root, WORKSPACES_DIR);
    this.#stateFile = path.join(root, STATE_FILE);
  }

  async prompts(): Promise<StoredPrompt[]> {
    const files = (await readdir(this.promptsDir).catch(() => [])).filter((f) => f.endsWith('.md'));

    return Promise.all(files.sort().map((file) => this.prompt(file.replace(/\.md$/, ''))));
  }

  async prompt(name: string): Promise<StoredPrompt> {
    const file = path.join(this.promptsDir, `${name}.md`);
    const source = await readFile(file, 'utf8').catch(() => {
      throw new Error(
        `No stored prompt "${name}" (looked for ${path.relative(process.cwd(), file)})`,
      );
    });

    return parsePromptFile({ name, source });
  }

  async state(): Promise<WorkbookState> {
    const raw = await readFile(this.#stateFile, 'utf8').catch(() => undefined);

    if (raw === undefined) return { ...EMPTY_STATE, lastRunByPrompt: {} };

    const parsed = stateSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      throw new Error(
        `${STATE_FILE} is invalid (delete it to start over):\n${z.prettifyError(parsed.error)}`,
      );
    }

    return parsed.data;
  }

  /** Claims the next run number and folder, and remembers it as the prompt's latest run. */
  async beginRun(params: {
    prompt: string;
    id: (number: number) => string;
  }): Promise<RunPaths & { id: string }> {
    const state = await this.state();
    const id = params.id(state.runCount + 1);
    const paths = runPaths({ runsDir: this.runsDir, id });

    await mkdir(paths.dir, { recursive: true });
    await this.#saveState({
      ...state,
      runCount: state.runCount + 1,
      lastRun: id,
      lastRunByPrompt: { ...state.lastRunByPrompt, [params.prompt]: id },
    });

    return { ...paths, id };
  }

  /**
   * The workspace a run works in: a fresh copy of the prompt's fixture (or an empty folder), or,
   * with `keep`, the prompt's existing workspace from the last run, so work builds up.
   */
  async workspace(params: {
    prompt: StoredPrompt | undefined;
    key: string;
    keep: boolean;
  }): Promise<string> {
    const { prompt, key, keep } = params;
    const dir = path.join(this.workspacesDir, 'runs', key);
    const exists = await readdir(dir).then(
      () => true,
      () => false,
    );

    if (keep && exists) return dir;

    await rm(dir, { recursive: true, force: true });

    if (prompt?.workspace) {
      await cp(path.join(this.workspacesDir, prompt.workspace), dir, { recursive: true });
    } else {
      await mkdir(dir, { recursive: true });
    }

    // A fake secret for the guards to protect. Written here, not stored: `.env*` files are
    // git-ignored, and a fixture that looks like it holds secrets shouldn't be committed.
    await writeFile(path.join(dir, '.env'), FAKE_ENV);

    return dir;
  }

  /** A run by id, or `last` / undefined for the latest. */
  async resolveRun(id: string | undefined): Promise<string> {
    if (id && id !== 'last') {
      const runs = await this.runIds();
      // `7` means run `0007-…`; otherwise a full id or any unique start of one.
      const number = /^\d+$/.test(id) ? `${id.padStart(4, '0')}-` : undefined;
      const match =
        runs.find((run) => run === id) ?? runs.find((run) => run.startsWith(number ?? id));

      if (!match) {
        throw new Error(`No run "${id}". Runs: ${runs.slice(-5).join(', ') || 'none yet'}`);
      }

      return match;
    }

    const { lastRun } = await this.state();

    if (!lastRun) throw new Error('No runs yet: start one with `npm run workbook -- run <prompt>`');

    return lastRun;
  }

  async runIds(): Promise<string[]> {
    return (await readdir(this.runsDir).catch(() => [])).sort();
  }

  async meta(id: string): Promise<RunMeta> {
    return runMetaSchema.parse(JSON.parse(await readFile(this.#paths(id).meta, 'utf8')));
  }

  /** The run's result, or undefined if it never finished (crashed or still running). */
  async result(id: string): Promise<RunResult | undefined> {
    const raw = await readFile(this.#paths(id).result, 'utf8').catch(() => undefined);

    return raw === undefined ? undefined : runResultSchema.parse(JSON.parse(raw));
  }

  async events(id: string): Promise<AgentEvent[]> {
    const raw = await readFile(this.#paths(id).events, 'utf8').catch(() => '');

    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent);
  }

  /** The run's final conversation, to continue from. */
  async messages(id: string): Promise<Message[]> {
    const raw = await readFile(this.#paths(id).messages, 'utf8').catch(() => {
      throw new Error(
        `Run ${id} has no saved conversation (it didn't finish), so it can't be continued`,
      );
    });

    return JSON.parse(raw) as Message[];
  }

  paths(id: string): RunPaths {
    return this.#paths(id);
  }

  #paths(id: string): RunPaths {
    return runPaths({ runsDir: this.runsDir, id });
  }

  async #saveState(state: WorkbookState): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.#stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }
}
