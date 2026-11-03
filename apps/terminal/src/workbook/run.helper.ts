import { execFileSync } from 'node:child_process';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import type { Message } from '@sheavly/protocol/message/message.types';
import type { StreamEntry } from '@sheavly/protocol/stream/stream.types';
import { connectBackend } from '../client/backend.helper.js';
import { RemoteConversation } from '../client/conversation.service.js';
import { SAME_KEYPRESS_MS } from '../render/render.constants.js';
import { Renderer } from '../render/render.service.js';
import { projectTrustNotice, shortId } from '../render/render.utils.js';
import { RunRecorder } from './recorder.service.js';
import type { WorkbookStore } from './store.service.js';
import type { RunRequest, RunResult } from './workbook.types.js';
import { runId } from './workbook.utils.js';

/**
 * One workbook run: claims a run folder, prepares the workspace, starts a backend for it alone
 * (on that workspace, with the run's trust, turn limit and model-call file), then streams the run
 * to the terminal while recording everything (`RunRecorder`). Ctrl+C stops it cleanly and still
 * saves the result; a failure is saved as `outcome: failed` with the error.
 */
export async function runWorkbook(params: {
  store: WorkbookStore;
  request: RunRequest;
  /** Where trust is remembered: the user's store by default, a throwaway file for `check`. */
  trustFile?: string;
}): Promise<RunResult & { id: string }> {
  const { store, request, trustFile } = params;
  const paths = await store.beginRun({
    prompt: request.name,
    id: (number) => runId({ number, prompt: request.name }),
  });
  const { history, workspace: previousWorkspace } = await startingPoint({ store, request });
  const workspace = previousWorkspace
    ? { dir: previousWorkspace, fresh: false }
    : await store.workspace({ prompt: request.stored, key: request.name, keep: request.keep });
  // The recorder is created first so everything the backend prints goes in the transcript.
  const recorder = new RunRecorder(paths);
  const write = (text: string) => {
    process.stdout.write(text);
    recorder.transcript(text);
  };
  const backend = await connectBackend({
    env: runEnv({ request, workspaceRoot: workspace.dir, modelCalls: paths.modelCalls, trustFile }),
    // A fresh copy of a committed fixture is this repo's own code, so its hooks run. A kept or
    // continued workspace the agent may have edited needs trust like any other: `--trust`.
    args: workspace.fresh || request.trust ? ['--trust'] : [],
    onOutput: write,
  });

  try {
    return await streamRun({ store, request, history, paths, recorder, write, backend });
  } finally {
    await backend.stop();
  }
}

/** What the run's backend reads: the run's workspace, limits and files, over this environment. */
function runEnv(params: {
  request: RunRequest;
  workspaceRoot: string;
  modelCalls: string;
  trustFile: string | undefined;
}): NodeJS.ProcessEnv {
  const { request, workspaceRoot, modelCalls, trustFile } = params;

  return {
    ...process.env,
    WORKSPACE_ROOT: workspaceRoot,
    MODEL_CALLS_FILE: modelCalls,
    WAIT_FOR_TASKS: 'true',
    SHOW_MODEL_CALLS: request.showModelCalls ? 'true' : 'false',
    ...(request.stored?.maxTurns !== undefined && { MAX_TURNS: String(request.stored.maxTurns) }),
    ...(trustFile && { SHEAVLY_TRUST_FILE: trustFile }),
  };
}

/** Runs the prompt on the backend's new conversation, recording it, and saves the result. */
async function streamRun(params: {
  store: WorkbookStore;
  request: RunRequest;
  history: Message[];
  paths: Awaited<ReturnType<WorkbookStore['beginRun']>>;
  recorder: RunRecorder;
  write: (text: string) => void;
  backend: Awaited<ReturnType<typeof connectBackend>>;
}): Promise<RunResult & { id: string }> {
  const { request, history, paths, recorder, write, backend } = params;
  const conversation = await RemoteConversation.open({ backend, messages: history });
  const details = await conversation.details();
  const renderer = new Renderer(write, () => conversation.runningTasks);
  const stopStream = new AbortController();

  recorder.recordSessions(await conversation.rawStream(stopStream.signal), stopStream);
  await recorder.start({
    id: paths.id,
    prompt: request.name,
    text: request.text,
    ...(request.continues !== undefined && { continues: request.continues }),
    startedAt: new Date().toISOString(),
    adapter: details.model.adapter,
    model: details.model.model,
    workspace: details.workspace,
    mainSession: details.session,
    ...gitCommit(),
  });

  write(`→ run ${paths.id} · ${details.model.adapter} / ${details.model.model}\n`);
  write(`→ workspace ${details.workspace}\n`);
  if (request.continues) write(`→ continues ${request.continues} (${history.length} messages)\n`);

  // Written to the transcript too, so a saved run shows its hooks were skipped and why.
  const trustNotice = projectTrustNotice(details.projectTrust);

  if (trustNotice) write(`${trustNotice}\n`);
  write(`→ main session ${shortId(details.session)}\n→ ${request.text}\n\n`);

  const interrupt = interruptOnCtrlC(write);
  const sessions = new Set([details.session]);
  let outcome: RunResult['outcome'] = 'failed';
  let error: string | undefined;

  try {
    // Skills the prompt mentions (`/<name>` anywhere in it) run with it, as in the chat.
    for await (const entry of conversation.send({ text: request.text, signal: interrupt.signal })) {
      sessions.add(entry.sessionId);
      if (entry.kind === 'event') recorder.event(entry.event);
      renderer.entry(entry, details.session);
      outcome = mainOutcome({ entry, mainSession: details.session }) ?? outcome;
    }
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
    write(`\n✗ Run failed: ${error}\n`);
  } finally {
    interrupt.dispose();
  }

  const result = await recorder.finish({
    outcome,
    error,
    messages: await conversation.messages(),
    sessions: sessions.size,
  });

  await conversation.close();
  process.stdout.write(`\n→ saved to ${paths.dir}\n`);

  return { ...result, id: paths.id };
}

/** How the run ended, from the main session's `done`; undefined for every other entry. */
function mainOutcome(params: {
  entry: StreamEntry;
  mainSession: string;
}): RunResult['outcome'] | undefined {
  const { entry, mainSession } = params;

  if (entry.kind !== 'event' || entry.sessionId !== mainSession) return undefined;

  return entry.event.type === 'done' ? entry.event.reason : undefined;
}

/** A follow-up starts from that run's conversation, in that run's workspace. */
async function startingPoint(params: {
  store: WorkbookStore;
  request: RunRequest;
}): Promise<{ history: Message[]; workspace?: string }> {
  const { store, request } = params;

  if (!request.continues) return { history: [] };

  const [history, meta] = await Promise.all([
    store.messages(request.continues),
    store.meta(request.continues),
  ]);

  return { history, workspace: meta.workspace };
}

/** Ctrl+C once stops the run cleanly (its result is still saved); twice force-quits. */
function interruptOnCtrlC(write: (text: string) => void) {
  const controller = new AbortController();
  let interruptedAt = 0;
  const onSigint = () => {
    if (controller.signal.aborted) {
      if (Date.now() - interruptedAt < SAME_KEYPRESS_MS) return;
      write('\n✗ Forced exit (the run folder has everything up to here).\n');
      process.exit(130);
    }

    interruptedAt = Date.now();
    write('\n⏹ Interrupting… (Ctrl+C again to force quit)\n');
    controller.abort();
  };

  process.on('SIGINT', onSigint);

  return { signal: controller.signal, dispose: () => process.off('SIGINT', onSigint) };
}

/** The commit the harness was at, so a run can be tied to the code that produced it. */
function gitCommit(): { gitCommit?: string } {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();

    return { gitCommit: dirty ? `${commit}+uncommitted` : commit };
  } catch (caughtError) {
    // Not a git checkout (git exits non-zero) or no git installed (ENOENT): the run simply has
    // no commit to record. Anything else is a real failure and surfaces.
    const status = (caughtError as { status?: unknown }).status;

    if (typeof status === 'number' || isMissingPath(caughtError)) return {};
    throw caughtError;
  }
}
