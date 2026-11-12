import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrThrow } from '@sheavly/core/validation/validation.validator';
import { WorkbookStoreError } from '../errors/workbook.errors.js';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { DocumentFile } from '@sheavly/storage/document-file/document-file.service';
import { TrustStore } from '@sheavly/workspace/trust/trust.service';
import { resolveWritable } from '@sheavly/coding/files/files.helper';
import type { Check, CheckOutcome, CheckStep, Observed, RunSources } from './check.types.js';
import {
  formatReport,
  isRunSource,
  judgeRun,
  toolResultOutputs,
  touchesAreas,
} from './check.utils.js';
import { runSourcesSchema } from './check.validator.js';
import { runWorkbook } from './run.helper.js';
import { assertCheckBackend } from './check-isolation.helper.js';
import { parseApprovedCommands } from './check-approval.validator.js';
import { stepApprovedCommands } from './check-approval.utils.js';
import type { WorkbookStore } from './store.service.js';
import { ATTEMPTS, BASE, RUN_SOURCES_FILE } from './workbook.constants.js';
import type { StoredPrompt } from './workbook.types.js';
import { toolsUsed } from './workbook.utils.js';

/** A stored prompt that has a check. */
type CheckedPrompt = StoredPrompt & { check: Check };

/**
 * Files this branch changed since `BASE`, committed or not, repo-relative. The branch's own
 * history is what a check covers; a git failure stops the command, never "nothing changed".
 */
function changedFiles(): string[] {
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
  const base = git(['merge-base', BASE, 'HEAD']).trim();
  const lists = [
    git(['diff', '--name-only', base]),
    git(['ls-files', '--others', '--exclude-standard']),
  ];

  return [...new Set(lists.join('\n').split('\n').filter(Boolean))];
}

/**
 * Which prompts to check: the named ones, else every one with a check whose `areas` the branch
 * changed (`all` for every one). Also says which changed source files no check covers.
 */
export function selectChecks(params: {
  prompts: StoredPrompt[];
  names: string[];
  all: boolean;
  changed: string[];
  sources: RunSources;
}): { checks: CheckedPrompt[]; uncovered: string[]; unknown: string[] } {
  const { prompts, names, all, changed, sources } = params;
  const checked = prompts.filter((prompt): prompt is CheckedPrompt => prompt.check !== undefined);
  const covered = (file: string) =>
    checked.some(({ check }) => touchesAreas({ areas: check.areas, files: [file] }));
  const uncovered = changed.filter((file) => isRunSource({ sources, file }) && !covered(file));

  if (names.length > 0) {
    // A typo or a prompt without a check must not look like a pass: it's reported as unknown.
    const unknown = names.filter((name) => !checked.some((prompt) => prompt.name === name));

    return { checks: checked.filter((prompt) => names.includes(prompt.name)), uncovered, unknown };
  }

  if (all) return { checks: checked, uncovered, unknown: [] };

  return {
    checks: checked.filter(({ check }) => touchesAreas({ areas: check.areas, files: changed })),
    uncovered,
    unknown: [],
  };
}

/** `workbook/run-sources.json`, the list the stop hook reads too. Missing or invalid stops the check. */
async function readRunSources(store: WorkbookStore): Promise<RunSources> {
  const file = path.join(store.root, RUN_SOURCES_FILE);
  let json: unknown;

  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (caughtError) {
    throw new WorkbookStoreError({ file, cause: caughtError });
  }

  return parseOrThrow({
    schema: runSourcesSchema,
    input: json,
    onInvalid: ({ details, error }) =>
      new WorkbookStoreError({ file, cause: error, reason: details }),
  });
}

/** What a saved run produced, read back from its files. */
async function observe(params: { store: WorkbookStore; id: string }): Promise<Observed> {
  const { store, id } = params;
  const [events, result, reply, meta] = await Promise.all([
    store.events(id),
    store.result(id),
    store.answer(id),
    store.meta(id),
  ]);
  const file = store.paths(id).transcript;
  let transcript: string;

  try {
    transcript = await readFile(file, 'utf8');
  } catch (caughtError) {
    throw new WorkbookStoreError({ file, cause: caughtError });
  }

  return {
    transcript,
    reply,
    ...toolResultOutputs(events),
    events: events.map((event) => event.type),
    contextHooks: events
      .filter((event) => event.type === 'context_added')
      .map((event) => event.hook),
    tools: toolsUsed(events),
    outcome: result?.outcome ?? 'failed',
    adapter: meta.adapter,
  };
}

/** The steps a check takes: its own list, or one run of the prompt. */
function stepsOf(check: Check): CheckStep[] {
  return check.steps ?? [{ run: { keep: false, trust: false }, ...check }];
}

/** Runs every step of one check once; returns its problems and the runs it made. */
async function attempt(params: {
  store: WorkbookStore;
  prompt: CheckedPrompt;
  approvedCommands: readonly string[];
  model: string | undefined;
}): Promise<{ problems: string[]; runs: string[]; interrupted: boolean }> {
  const { store, prompt } = params;
  // A fresh trust store per attempt, outside every repo: a check never touches the user's own.
  // Each run's backend reads it (SHEAVLY_TRUST_FILE); an `untrust` step revokes from it here.
  const scratch = await mkdtemp(path.join(tmpdir(), 'workbook-check-'));
  const trustFile = path.join(scratch, 'trusted-workspaces.json');
  const trustStore = new TrustStore({ persistence: new DocumentFile({ file: trustFile }) });
  const problems: string[] = [];
  const runs: string[] = [];

  try {
    for (const [index, step] of stepsOf(prompt.check).entries()) {
      if ('append' in step) {
        await appendToWorkspace({ store, prompt, append: step.append });
        continue;
      }

      if ('untrust' in step) {
        await trustStore.revoke({ root: store.runWorkspaceDir(prompt.name) });
        continue;
      }

      const result = await runWorkbook({
        store,
        trustFile,
        checkContext: {
          approvedCommands: stepApprovedCommands({
            step,
            approvedCommands: params.approvedCommands,
          }),
        },
        request: {
          name: prompt.name,
          text: step.run.text ?? prompt.text,
          stored: prompt,
          keep: step.run.keep,
          trust: step.run.trust,
          showModelCalls: false,
          model: params.model,
        },
      });

      runs.push(result.id);

      // The user stopped it (Ctrl+C): no more steps, and no judging a run they cut short.
      if (result.outcome === 'interrupted') return { problems, runs, interrupted: true };

      const label = `step ${index + 1} (${result.id})`;
      const found = judgeRun({
        expectation: step,
        observed: await observe({ store, id: result.id }),
      });

      problems.push(...found.map((problem) => `${label}: ${problem}`));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  return { problems, runs, interrupted: false };
}

/** An `append` step: adds text to a file in the prompt's workspace, with the file tools' guards. */
export async function appendToWorkspace(params: {
  store: WorkbookStore;
  prompt: StoredPrompt;
  append: { file: string; text: string };
}): Promise<void> {
  const { store, prompt, append } = params;
  const workspace = await Workspace.open(store.runWorkspaceDir(prompt.name));
  // The file tools' own rules: inside the workspace, never a .env file, never inside .git.
  const file = await resolveWritable({ workspace, requested: append.file, root: undefined });

  await appendFile(file, append.text);
}

/** Runs one check, retrying a failure once; the second try decides. */
async function runCheck(params: {
  store: WorkbookStore;
  prompt: CheckedPrompt;
  approvedCommands: readonly string[];
  model: string | undefined;
}): Promise<CheckOutcome> {
  const attempts: string[][] = [];
  const runs: string[] = [];

  for (let tries = 0; tries < ATTEMPTS; tries++) {
    const result = await attempt(params);

    attempts.push(result.problems);
    runs.push(...result.runs);

    if (result.interrupted) {
      return { prompt: params.prompt.name, status: 'interrupted', attempts, runs };
    }

    if (result.problems.length === 0) break;
  }

  const passed = attempts.at(-1)?.length === 0;
  let status: CheckOutcome['status'] = 'failed';

  if (passed) status = attempts.length > 1 ? 'passed_on_retry' : 'passed';

  return { prompt: params.prompt.name, status, attempts, runs };
}

/**
 * `check`: runs the selected checks against the real model and reports each. Returns whether
 * every one passed. Says which changed source no check covers, so missing coverage shows.
 */
export async function checkWorkbook(params: {
  store: WorkbookStore;
  names: string[];
  all: boolean;
  approvedCommands?: readonly string[];
  /** The model every run of every check starts on (id or name); the profile's own when omitted. */
  model?: string | undefined;
  write: (text: string) => void;
}): Promise<boolean> {
  assertCheckBackend(process.env);
  const approvedCommands = parseApprovedCommands(params.approvedCommands ?? []);
  const { store, names, all, write, model } = params;
  const changed = names.length > 0 || all ? [] : changedFiles();
  const { checks, uncovered, unknown } = selectChecks({
    prompts: await store.prompts(),
    names,
    all,
    changed,
    sources: await readRunSources(store),
  });

  if (unknown.length > 0) {
    write(
      `✗ No check named ${unknown.join(', ')} (a prompt needs a \`check\` in its front matter)\n`,
    );

    return false;
  }

  if (uncovered.length > 0) write(`No check covers: ${uncovered.join(', ')}\n`);

  if (checks.length === 0) {
    write('No checks to run: nothing this branch changed is covered (--all runs every one).\n');

    return true;
  }

  write(`Checking ${checks.map((prompt) => prompt.name).join(', ')}…\n`);

  const outcomes: CheckOutcome[] = [];

  for (const prompt of checks) {
    const outcome = await runCheck({ store, prompt, approvedCommands, model });

    outcomes.push(outcome);
    // Ctrl+C stops the paid runs: nothing more starts after a stopped one.
    if (outcome.status === 'interrupted') break;
  }

  write(`\n${formatReport(outcomes)}\n`);

  return outcomes.every(
    (outcome) => outcome.status === 'passed' || outcome.status === 'passed_on_retry',
  );
}
