import { afterEach, describe, expect, it } from 'vitest';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { formatTask } from '@sheavly/runtime/tasks/tasks.utils';
import { OutputError } from '@sheavly/core/errors/output.errors';
import { findOutputRefs } from '@sheavly/protocol/output/output.utils';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { until } from '@sheavly/testing/wait/until.fake';
import { createOutputTools } from '@sheavly/tools/output/output.tool';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { testPermissions } from '../../testing/permissions.fake.js';
import { runForeground } from '../foreground.helper.js';
import { createRunCommandTool } from '../run-command.tool.js';
import { createStartServiceTool } from '../start-service.tool.js';

const temp = useTempWorkspace({ prefix: 'run-command-capture-test-' });
const fileReads = useFileReads();
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
});

function setup(outputs: MemoryOutputStore | undefined = new MemoryOutputStore()) {
  tasks = new TaskRegistry();

  const options = {
    fileReads: fileReads.current,
    processes: testProcesses(),
    workspace: temp.workspace,
    permissions: testPermissions({ mode: 'allow_all' }),
    tasks,
    outputs,
  };

  return {
    outputs,
    run: toolRunner(
      [
        createRunCommandTool(options),
        createStartServiceTool(options),
        ...createOutputTools(outputs),
      ],
      new SessionRegistry().startMain({ title: 'Main' }),
    ),
  };
}

const textOf = (result: { role: string; content?: string }) => result.content ?? '';
/** A command whose output is far longer than the preview, with a marker in the middle. */
// The marker is built at run time so the command line the result echoes does not contain it.
const BIG = `node -e "for(let i=0;i<5000;i++)console.log(i===2500?'MIDDLE-'+'MARKER':'line '+i)"`;

describe('run_command output capture', () => {
  it('keeps the complete output of a foreground command and points to it when the preview is cut', async () => {
    const { run } = setup();
    const result = textOf(await run('c1', 'run_command', { command: BIG }));
    const [ref] = findOutputRefs(result);

    expect(result).toContain('lines omitted');
    expect(result).not.toContain('MIDDLE-MARKER');
    expect(result).toContain('shortened preview');
    expect(result).toContain('read_output');
    expect(result).toContain('Do not rerun the command');
    expect(ref).toBeDefined();

    const found = textOf(await run('c2', 'search_output', { ref, query: 'MIDDLE-MARKER' }));

    expect(found).toContain('1 match(es)');
    expect(found).toContain('MIDDLE-MARKER');
  });

  it('shows the reference without the cut-off hint when nothing was cut', async () => {
    const { run } = setup();
    const result = textOf(await run('c1', 'run_command', { command: 'echo small' }));

    expect(result).toContain('Full output: output_ref=');
    expect(result).toContain('complete');
    expect(result).not.toContain('shortened preview');
  });

  it('captures a background task from the start, readable while it runs and after it fails', async () => {
    const { run } = setup();
    const started = textOf(
      await run('b1', 'run_command', {
        command: `node -e "console.log('early');setTimeout(()=>process.exit(3),400)"`,
        background: true,
      }),
    );
    const [ref] = findOutputRefs(started);

    expect(ref).toBeDefined();
    expect(started).toContain('output_ref=');

    await until(() => tasks.list()[0]?.output.includes('early') ?? false);
    expect(textOf(await run('b2', 'read_output', { ref }))).toContain('still capturing');

    await until(() => tasks.list()[0]?.status === 'failed');

    const task = tasks.list()[0]!;

    expect(task.outputLog).toMatchObject({ ref, status: 'complete' });
    expect(formatTask({ task, now: task.endedAt ?? task.startedAt })).toContain(
      `output_ref=${ref}`,
    );
    expect(textOf(await run('b3', 'read_output', { ref }))).toContain('early');
  });

  it('keeps what a cancelled task printed', async () => {
    const { run } = setup();
    const started = textOf(
      await run('b1', 'start_service', {
        command: `node -e "console.log('before cancel');setTimeout(()=>{},9e4)"`,
      }),
    );
    const [ref] = findOutputRefs(started);

    await until(() => tasks.list()[0]?.output.includes('before cancel') ?? false);
    await tasks.cancel(tasks.list()[0]!.id);

    expect(tasks.list()[0]?.outputLog?.status).toBe('complete');
    expect(textOf(await run('b2', 'read_output', { ref }))).toContain('before cancel');
  });

  it.each([
    {
      name: 'storage cannot start a capture',
      refuse: (outputs: MemoryOutputStore) => outputs.failWith(new Error('disk full')),
      reason: 'Stored command output is unavailable',
    },
    {
      name: 'the conversation holds the most logs it keeps',
      refuse: (outputs: MemoryOutputStore) =>
        outputs.refuseWith(
          new OutputError({
            reason: 'quota_exceeded',
            message: 'This conversation already stores 5 outputs.',
          }),
        ),
      reason: 'already stores 5 outputs',
    },
  ])('runs the command and says why its full output is not kept when $name', async (refusal) => {
    const outputs = new MemoryOutputStore();

    refusal.refuse(outputs);

    const { run } = setup(outputs);
    const result = textOf(await run('c1', 'run_command', { command: 'echo hi' }));

    expect(result).toContain('hi');
    expect(result).toContain('NOT being stored');
    expect(result).toContain(refusal.reason);
    expect(findOutputRefs(result)).toEqual([]);
  });

  it('marks an interrupted capture incomplete, never complete', async () => {
    const outputs = new MemoryOutputStore();

    outputs.failAppends('storage failed: disk full');

    const { run } = setup(outputs);
    const result = textOf(await run('c1', 'run_command', { command: 'echo hi' }));

    expect(result).toContain('INCOMPLETE');
    expect(result).toContain('not everything the command printed');
  });

  it('adds no output lines and no tool text when no store is given', async () => {
    tasks = new TaskRegistry();

    const run = toolRunner([
      createRunCommandTool({
        fileReads: fileReads.current,
        processes: testProcesses(),
        workspace: temp.workspace,
        permissions: testPermissions({ mode: 'allow_all' }),
      }),
    ]);
    const result = textOf(await run('c1', 'run_command', { command: 'echo hi' }));

    expect(result).not.toContain('output_ref');
    expect(result).not.toContain('NOT being stored');
  });

  it('names the stored output in the error when a later command cannot start', async () => {
    const outputs = new MemoryOutputStore();
    const failure = runForeground({
      command: 'node print ; missing',
      script: {
        steps: [
          { argv: ['node', '-e', `console.log('printed first')`], joinedBy: ';' },
          { argv: ['sheavly-no-such-program'] },
        ],
        cwd: temp.workspace.root,
        signal: new AbortController().signal,
      },
      processes: testProcesses(),
      outputs,
      fileReads: fileReads.current,
    }).catch((caughtError: unknown) => caughtError);
    const error = await failure;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('output_ref=');
    expect((error as Error).message).toContain('read_output');
  });

  it('keeps output printed before a foreground timeout', async () => {
    tasks = new TaskRegistry();

    const outputs = new MemoryOutputStore();
    const run = toolRunner([
      createRunCommandTool({
        fileReads: fileReads.current,
        processes: testProcesses(),
        workspace: temp.workspace,
        permissions: testPermissions({ mode: 'allow_all' }),
        outputs,
        timeoutMs: 600,
      }),
    ]);
    const result = textOf(
      await run('c1', 'run_command', {
        command: `node -e "console.log('before timeout');setTimeout(()=>{},9e4)"`,
      }),
    );
    const [ref] = findOutputRefs(result);

    expect(result).toContain('timed out');
    expect((await outputs.read({ ref: ref!, offset: 0, maxBytes: 100 })).text).toContain(
      'before timeout',
    );
  });
});
