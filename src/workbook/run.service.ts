import { execFileSync } from 'node:child_process';
import type { Message } from '@sheavly/core/message/message.types';
import { streamAgent } from '../loop/stream-agent/stream-agent.service.js';
import { HOST_MAX_TURNS } from '../host/host.constants.js';
import { createHarness, trustStoreFromEnv } from '../host/host.service.js';
import type { ProviderSettings } from '../host/host.types.js';
import { isMissingPath } from '../runtime/errors/errors.utils.js';
import type { TrustStore } from '../runtime/trust/trust.service.js';
import { SAME_KEYPRESS_MS } from '../terminal-ui/render.constants.js';
import { Renderer } from '../terminal-ui/render.service.js';
import { projectTrustNotice, shortId } from '../terminal-ui/render.utils.js';
import { RunRecorder } from './recorder.service.js';
import type { WorkbookStore } from './store.service.js';
import type { RunRequest, RunResult } from './workbook.types.js';
import { runId } from './workbook.utils.js';

/**
 * One workbook run: claims a run folder, prepares the workspace, wires the harness like the demo,
 * then streams the run to the terminal while recording everything (`RunRecorder`). Ctrl+C stops
 * it cleanly and still saves the result; a failure is saved as `outcome: failed` with the error.
 */
export async function runWorkbook(params: {
  store: WorkbookStore;
  settings: ProviderSettings;
  request: RunRequest;
  /** Where trust is remembered: the user's store by default, a throwaway one for `check`. */
  trustStore?: TrustStore;
}): Promise<RunResult & { id: string }> {
  const { store, settings, request, trustStore = trustStoreFromEnv() } = params;
  const paths = await store.beginRun({
    prompt: request.name,
    id: (number) => runId({ number, prompt: request.name }),
  });
  const { history, workspace: previousWorkspace } = await startingPoint({ store, request });
  const workspace = previousWorkspace
    ? { dir: previousWorkspace, fresh: false }
    : await store.workspace({ prompt: request.stored, key: request.name, keep: request.keep });
  const workspaceRoot = workspace.dir;
  // The recorder is created first so the model-call hook below can write to it.
  const recorder = new RunRecorder(paths);
  const write = (text: string) => {
    process.stdout.write(text);
    recorder.transcript(text);
  };
  const view: { renderer?: Renderer } = {};
  const harness = await createHarness({
    provider: settings.provider,
    workspaceRoot,
    title: request.text,
    trustStore,
    // A fresh copy of a committed fixture is this repo's own code, so its hooks run. A kept or
    // continued workspace the agent may have edited needs trust like any other: `--trust`.
    trustWorkspace: workspace.fresh || request.trust,
    onModelCall: (sent) => {
      recorder.modelCall(sent);
      if (request.showModelCalls) view.renderer?.modelCall(sent);
    },
  });
  const { sessions, mainSession, tasks } = harness;

  const renderer = new Renderer(write, tasks);

  view.renderer = renderer;
  sessions.subscribe((update) => renderer.session(update));
  recorder.recordSessions(sessions);

  await recorder.start({
    id: paths.id,
    prompt: request.name,
    text: request.text,
    ...(request.continues !== undefined && { continues: request.continues }),
    startedAt: new Date().toISOString(),
    adapter: settings.adapter,
    model: settings.model,
    workspace: harness.workspace.root,
    mainSession: mainSession.id,
    ...gitCommit(),
  });

  write(`→ run ${paths.id} · ${settings.adapter} / ${settings.model}\n`);
  write(`→ workspace ${harness.workspace.root}\n`);
  if (request.continues) write(`→ continues ${request.continues} (${history.length} messages)\n`);

  // Written to the transcript too, so a saved run shows its hooks were skipped and why.
  const trustNotice = projectTrustNotice(harness.projectTrust);

  if (trustNotice) write(`${trustNotice}\n`);
  write(`→ main session ${shortId(mainSession.id)}\n→ ${request.text}\n\n`);

  const interrupt = interruptOnCtrlC(write);
  let messages: Message[] = [...history, { role: 'user', content: request.text }];
  let outcome: RunResult['outcome'] = 'failed';
  let error: string | undefined;

  try {
    for await (const event of streamAgent({
      provider: harness.provider,
      tools: harness.tools,
      hooks: harness.hooks,
      messages,
      maxTurns: request.stored?.maxTurns ?? HOST_MAX_TURNS,
      signal: interrupt.signal,
      tasks,
      session: { registry: sessions, ref: mainSession },
      waitForTasks: true,
    })) {
      recorder.event(event);
      renderer.event(event);

      if (event.type === 'done') {
        outcome = event.reason;
        messages = event.messages;
      }
    }
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
    write(`\n✗ Run failed: ${error}\n`);
  } finally {
    interrupt.dispose();
    await tasks.cancelAll();
  }

  const result = await recorder.finish({
    outcome,
    error,
    messages,
    sessions: sessions.list().length,
  });

  process.stdout.write(`\n→ saved to ${paths.dir}\n`);

  return { ...result, id: paths.id };
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
