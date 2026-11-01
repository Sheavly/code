import { execFileSync } from 'node:child_process';
import type { Message } from '@sheavly/core/message/message.types';
import { streamAgent } from '../loop/stream-agent/stream-agent.service.js';
import { HOST_MAX_TURNS } from '../host/host.constants.js';
import { createHarness } from '../host/host.service.js';
import type { ProviderSettings } from '../host/host.types.js';
import { SAME_KEYPRESS_MS } from '../terminal-ui/render.constants.js';
import { Renderer } from '../terminal-ui/render.service.js';
import { shortId } from '../terminal-ui/render.utils.js';
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
}): Promise<RunResult> {
  const { store, settings, request } = params;
  const paths = await store.beginRun({
    prompt: request.name,
    id: (number) => runId({ number, prompt: request.name }),
  });
  const { history, workspace: previousWorkspace } = await startingPoint({ store, request });
  const workspaceRoot =
    previousWorkspace ??
    (await store.workspace({ prompt: request.stored, key: request.name, keep: request.keep }));
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

  return result;
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
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();

    return { gitCommit: dirty ? `${commit}+uncommitted` : commit };
  } catch {
    return {};
  }
}
