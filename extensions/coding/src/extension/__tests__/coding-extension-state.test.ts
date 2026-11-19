import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentStore } from '@sheavly/core/store/store.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import type { ApprovalId } from '@sheavly/protocol/approval/approval.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import type { SessionRef } from '@sheavly/protocol/session/session.types';
import { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
import { until } from '@sheavly/testing/wait/until.fake';
import { memoryShellStore } from '@sheavly/workspace/working-root/memory-shell.helper';
import { codingRun } from '../../testing/coding-run.fake.js';
import { testPermissions } from '../../testing/permissions.fake.js';

let project: string;
let base: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'coding-state-')));
  project = path.join(base, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'a.ts'), 'const a = 1;\n');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

type Run = Awaited<ReturnType<ReturnType<typeof codingRun>['activate']>>;

/** One tool of the run called as `session`, the way the loop calls it. */
function call(params: {
  run: Run;
  name: string;
  input: Record<string, unknown>;
  session: SessionRef;
  signal?: AbortSignal;
}) {
  const { run, name, input, session, signal = new AbortController().signal } = params;

  return runTool({
    tools: [run.tool(name)],
    call: { id: callIdSchema.parse(name), name, input: { description: name, ...input } },
    signal,
    session,
  });
}

const edit = (run: Run, session: SessionRef) =>
  call({
    run,
    name: 'edit_file',
    input: { path: 'a.ts', oldText: 'const a = 1;', newText: 'const a = 2;' },
    session,
  });

const read = (run: Run, session: SessionRef) =>
  call({ run, name: 'read_file', input: { path: 'a.ts' }, session });

/** A shell store in memory, and whether file reads have been written to it yet. */
function watchedShell() {
  const store = memoryShellStore();
  const state = { kept: false };
  const shell: DocumentStore = {
    load: () => store.load(),
    update: async (change) => {
      await store.update(change);

      const document = await store.load();

      state.kept ||= typeof document === 'object' && document !== null && 'fileReads' in document;
    },
  };

  return { shell, state };
}

describe('the file reads the coding extension keeps through the session service', () => {
  it('forgets what a session was shown once it is released, and keeps the main session’s', async () => {
    const coding = codingRun({ project });
    const run = await coding.activate();
    const { sessions, mainSession } = coding.harness;
    const child = sessions.startChild({
      parentId: mainSession.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'child',
    });

    await read(run, child);
    await read(run, mainSession);
    sessions.end({ id: child.id, state: 'completed' });
    sessions.release(child.id);

    const afterRelease = await edit(run, child);
    const main = await edit(run, mainSession);

    await run.deactivate();

    expect(afterRelease).toMatchObject({ isError: true });
    expect(afterRelease.content).toContain('You have not read a.ts');
    expect(main).toMatchObject({ isError: false });
  });

  it('keeps the main session’s reads when it goes idle, and restores them in a reopened run', async () => {
    const { shell, state } = watchedShell();
    const first = codingRun({ project, shell });
    const run = await first.activate();

    await read(run, first.harness.mainSession);
    first.harness.sessions.idle({ id: first.harness.mainSession.id, outcome: 'completed' });
    await until(() => state.kept);
    await run.deactivate();

    const reopened = codingRun({ project, harness: first.harness, shell: first.shell });
    const again = await reopened.activate();
    const result = await edit(again, first.harness.mainSession);

    await again.deactivate();

    expect(result).toMatchObject({ isError: false });
  });
});

/**
 * Locks that log when each `change` starts and ends, and let a test wait for a number of calls to
 * have asked for a turn, so ordering is asserted without waiting on a clock.
 */
class RecordingLocks extends KeyedLocks {
  readonly log: string[] = [];
  #calls = 0;
  readonly #waiting: { calls: number; resolve: () => void }[] = [];

  override async run<T>(params: {
    key: string;
    signal: AbortSignal;
    change: () => Promise<T>;
  }): Promise<T> {
    const id = ++this.#calls;

    for (const waiter of this.#waiting) if (waiter.calls <= id) waiter.resolve();

    return await super.run({
      ...params,
      change: async () => {
        this.log.push(`start ${String(id)}`);

        try {
          return await params.change();
        } finally {
          this.log.push(`end ${String(id)}`);
        }
      },
    });
  }

  /** Resolves once `calls` calls to `run` have been made. */
  untilCalls(calls: number): Promise<void> {
    if (this.#calls >= calls) return Promise.resolve();

    const { promise, resolve } = Promise.withResolvers<undefined>();

    this.#waiting.push({ calls, resolve: () => resolve(undefined) });

    return promise;
  }
}

describe('the file locks of coding extensions', () => {
  it('are shared by two runs given one set, so they take turns on one file', async () => {
    const fileLocks = new RecordingLocks();
    const [one, two] = [
      codingRun({ project, fileLocks }),
      codingRun({ project, fileLocks }),
    ] as const;
    const [runOne, runTwo] = [await one.activate(), await two.activate()];
    const release = Promise.withResolvers<undefined>();
    // Call 1: held by the test until released.
    const held = fileLocks.run({
      key: path.join(project, 'a.ts'),
      signal: new AbortController().signal,
      change: () => release.promise,
    });
    const readOne = read(runOne, one.harness.mainSession);
    const readTwo = read(runTwo, two.harness.mainSession);

    await fileLocks.untilCalls(3);

    // Both reads are queued behind the held change: none of theirs has started.
    expect(fileLocks.log.filter((entry) => entry.startsWith('start'))).toEqual(['start 1']);

    release.resolve(undefined);
    await held;

    expect(await readOne).toMatchObject({ isError: false });
    expect(await readTwo).toMatchObject({ isError: false });

    // After the held one, changes never overlap: each starts only once the one before it ended.
    expect(fileLocks.log.slice(0, 2)).toEqual(['start 1', 'end 1']);

    for (let index = 2; index < fileLocks.log.length; index += 2) {
      const [started, ended] = [fileLocks.log[index], fileLocks.log[index + 1]];

      expect(started?.replace('start', 'end')).toBe(ended);
    }

    await runOne.deactivate();
    await runTwo.deactivate();
  });

  it('are the run’s own when none is given, so another set does not hold it', async () => {
    const coding = codingRun({ project });
    const run = await coding.activate();
    const release = Promise.withResolvers<undefined>();
    const held = new KeyedLocks().run({
      key: path.join(project, 'a.ts'),
      signal: new AbortController().signal,
      change: () => release.promise,
    });

    expect(await read(run, coding.harness.mainSession)).toMatchObject({ isError: false });

    release.resolve(undefined);
    await held;
    await run.deactivate();
  });
});

describe('background commands and the session that owns them', () => {
  const service = (run: Run, session: SessionRef, signal?: AbortSignal) =>
    call({
      run,
      name: 'start_service',
      input: { command: 'sleep 30' },
      session,
      ...(signal && { signal }),
    });

  /** A coding run whose permissions already allow `sleep`, so no approval is asked. */
  const allowedRun = () =>
    codingRun({ project, permissions: testPermissions({ allow: ['sleep *'] }) });

  it.each([
    ['a sub-agent that ended', /has ended; work cannot start for it/, false],
    [
      'a sub-agent that was released',
      /Session .* (has ended|Unknown session)|Unknown session/,
      true,
    ],
  ])('fails with a clear error and starts no task for %s', async (_what, message, released) => {
    const coding = allowedRun();
    const run = await coding.activate();
    const { sessions, mainSession, tasks } = coding.harness;
    const child = sessions.startChild({
      parentId: mainSession.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'child',
    });

    sessions.end({ id: child.id, state: 'completed' });

    if (released) sessions.release(child.id);

    const result = await service(run, child);

    await run.deactivate();

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toMatch(message);
    expect(tasks.list()).toEqual([]);
  });

  it('fails with a clear error and starts no task for the main session once it ended', async () => {
    const coding = allowedRun();
    const run = await coding.activate();
    const { sessions, mainSession, tasks } = coding.harness;

    sessions.end({ id: mainSession.id, state: 'completed' });

    const result = await service(run, mainSession);

    await run.deactivate();

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('has ended; work cannot start for it');
    expect(tasks.list()).toEqual([]);
  });

  /** A run that asks about `sleep 30` and hands the test the request, answerable later. */
  async function askingRun() {
    const coding = codingRun({ project });
    const run = await coding.activate();
    const asked = Promise.withResolvers<ApprovalId>();

    coding.harness.approvals.subscribe((update) => {
      if (update.type === 'approval_requested') asked.resolve(update.request.id);
    });

    return { coding, run, asked: asked.promise };
  }

  it('does not start the command when the call was cancelled as the approval was given', async () => {
    const { coding, run, asked } = await askingRun();
    const cancel = new AbortController();
    const started = service(run, coding.harness.mainSession, cancel.signal);

    coding.harness.approvals.respond({
      id: await asked,
      response: { decision: 'approve' },
    });
    cancel.abort(new Error('cancelled'));

    const result = await started;

    await run.deactivate();

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('cancelled');
    expect(coding.harness.tasks.list()).toEqual([]);
  });

  it('does not start the command when the session ends while the approval is waiting', async () => {
    const { coding, run, asked } = await askingRun();
    const { sessions, mainSession, tasks } = coding.harness;
    const child = sessions.startChild({
      parentId: mainSession.id,
      startedByCall: callIdSchema.parse('c1'),
      title: 'child',
    });
    const started = service(run, child);

    await asked;
    sessions.end({ id: child.id, state: 'completed' });

    // Ending the session cancels what it asked, so the answer can no longer arrive.
    const result = await started;

    await run.deactivate();

    expect(result).toMatchObject({ isError: true });
    expect(tasks.list()).toEqual([]);
  });
});
