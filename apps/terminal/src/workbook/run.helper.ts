import { execFileSync } from 'node:child_process';
import { now } from '@sheavly/core/clock/clock.helper';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import type { ClientHistoryMessage } from '@sheavly/protocol/history/history.types';
import { runEnd } from '@sheavly/protocol/status/run-end.utils';
import { connectBackend } from '../client/backend.helper.js';
import { RemoteConversation } from '../client/conversation.service.js';
import { SAME_KEYPRESS_MS } from '../render/render.constants.js';
import { Renderer } from '../render/render.service.js';
import { projectTrustNotice, shortId } from '../render/render.utils.js';
import { plainTerminalText } from '../render/terminal-text.utils.js';
import { RunRecorder } from './recorder.service.js';
import { runEnv } from './run-env.utils.js';
import type { WorkbookStore } from './store.service.js';
import type { CheckContext, RunId, RunRequest, RunResult } from './workbook.types.js';
import { CheckApprovals } from './check-approvals.service.js';
import { assertCheckBackend, assertCheckWorkspace } from './check-isolation.helper.js';
import { WorkbookCheckError } from './check.errors.js';
import { parseApprovedCommands } from './check-approval.validator.js';
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
  checkContext?: CheckContext;
}): Promise<RunResult & { id: RunId }> {
  const { store, request, trustFile } = params;
  const checkContext = params.checkContext && {
    approvedCommands: parseApprovedCommands(params.checkContext.approvedCommands),
  };

  if (checkContext) {
    assertCheckBackend(process.env);

    if (request.continues) {
      throw new WorkbookCheckError({
        message: 'Checks cannot continue an arbitrary saved workspace.',
      });
    }
  }

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
  let backend: Awaited<ReturnType<typeof connectBackend>> | undefined;

  try {
    backend = await connectBackend({
      env: runEnv({
        env: process.env,
        request,
        workspaceRoot: workspace.dir,
        modelCalls: paths.modelCalls,
        trustFile,
      }),
      // Fresh committed fixture copies are trusted; kept workspaces require explicit trust.
      args: workspace.fresh || request.trust ? ['--trust'] : [],
      onOutput: write,
    });

    return await streamRun({
      store,
      request,
      history,
      paths,
      recorder,
      write,
      backend,
      checkContext,
      workspaceRoot: workspace.dir,
    });
  } finally {
    try {
      await backend?.stop();
    } finally {
      await recorder.dispose();
    }
  }
}

/** Runs the prompt on the backend's new conversation, recording it, and saves the result. */
async function streamRun(params: {
  store: WorkbookStore;
  request: RunRequest;
  history: ClientHistoryMessage[];
  paths: Awaited<ReturnType<WorkbookStore['beginRun']>>;
  recorder: RunRecorder;
  write: (text: string) => void;
  backend: Awaited<ReturnType<typeof connectBackend>>;
  checkContext: CheckContext | undefined;
  workspaceRoot: string;
}): Promise<RunResult & { id: RunId }> {
  const { backend, history } = params;
  const conversation = await RemoteConversation.open({
    backend,
    messages: history,
    model: params.request.model,
  });
  const stopStream = new AbortController();

  try {
    return await recordConversation({ ...params, conversation, stopStream });
  } finally {
    stopStream.abort();
    await conversation.close();
  }
}

async function recordConversation(
  params: Parameters<typeof streamRun>[0] & {
    conversation: RemoteConversation;
    stopStream: AbortController;
  },
): Promise<RunResult & { id: RunId }> {
  const { request, history, paths, recorder, write, conversation, stopStream, checkContext } =
    params;
  const details = await conversation.details();
  const verifyWorkspace = () =>
    assertCheckWorkspace({
      store: params.store,
      name: request.name,
      workspaceRoot: params.workspaceRoot,
      actualWorkspace: details.workspace,
    });

  if (checkContext) await verifyWorkspace();

  const renderer = new Renderer(write, () => conversation.runningTasks);

  recorder.recordSessions(await conversation.rawStream(stopStream.signal), stopStream);
  await recorder.start({
    id: paths.id,
    prompt: request.name,
    text: request.text,
    ...(request.continues !== undefined && { continues: request.continues }),
    startedAt: now(),
    adapter: details.model.adapter,
    model: details.model.model,
    workspace: details.workspace,
    mainSession: details.session,
    ...(checkContext && {
      approvedCommands: [...checkContext.approvedCommands],
      approvalScope: 'conversation-session' as const,
    }),
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
    const send = async (signal: AbortSignal) => {
      const combined = AbortSignal.any([signal, interrupt.signal]);

      combined.throwIfAborted();

      // Skills mentioned by the prompt run with it, as in the chat.
      for await (const entry of conversation.send({ text: request.text, signal: combined })) {
        // A watcher failure races the prompt to close the conversation; its late events must
        // not overwrite the saved failure or write to an already-closed recorder.
        if (signal.aborted && !interrupt.signal.aborted) break;

        sessions.add(entry.sessionId);
        if (entry.kind === 'event') recorder.event(entry.event);
        renderer.entry(entry, details.session);
        outcome = runEnd(entry) ?? outcome;
      }
    };

    if (checkContext) {
      const approvals = new CheckApprovals({
        conversation,
        approvedCommands: checkContext.approvedCommands,
        verifyWorkspace,
      });

      await approvals.run({ operation: send, signal: interrupt.signal });
    } else {
      await send(interrupt.signal);
    }
  } catch (caughtError) {
    outcome = interrupt.signal.aborted ? 'interrupted' : 'failed';
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
    write(`\n✗ Run failed: ${plainTerminalText(error)}\n`);
  } finally {
    interrupt.dispose();
  }

  const result = await recorder.finish({
    outcome,
    error,
    messages: await conversation.messages(),
    sessions: sessions.size,
  });

  process.stdout.write(`\n→ saved to ${paths.dir}\n`);

  return { ...result, id: paths.id };
}

/** A follow-up starts from that run's conversation, in that run's workspace. */
async function startingPoint(params: {
  store: WorkbookStore;
  request: RunRequest;
}): Promise<{ history: ClientHistoryMessage[]; workspace?: string }> {
  const { store, request } = params;

  if (!request.continues) return { history: [] };

  const [history, meta] = await Promise.all([
    store.messages(request.continues),
    store.meta(request.continues),
  ]);

  // A notice is written by the harness alone: a backend refuses one in a starting history.
  return {
    history: history.filter((entry) => entry.role !== 'notice'),
    workspace: meta.workspace,
  };
}

/** Ctrl+C once stops the run cleanly (its result is still saved); twice force-quits. */
function interruptOnCtrlC(write: (text: string) => void) {
  const controller = new AbortController();
  let interruptedAt = 0;
  const onSigint = () => {
    if (controller.signal.aborted) {
      if (now() - interruptedAt < SAME_KEYPRESS_MS) return;
      write('\n✗ Forced exit (the run folder has everything up to here).\n');
      process.exit(130);
    }

    interruptedAt = now();
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
