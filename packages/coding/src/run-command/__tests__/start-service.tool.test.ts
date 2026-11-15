import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
import { toolRunner } from '@sheavly/testing/tool/tool-runner.fake';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';
import type { RunCommandOptions } from '../run-command.types.js';
import { createStartServiceTool } from '../start-service.tool.js';

const temp = useTempWorkspace({ prefix: 'start-service-test-' });
const fileReads = useFileReads();
let tasks: TaskRegistry;

afterEach(async () => {
  await tasks.cancelAll();
  vi.restoreAllMocks();
});

/** The tool's options; each test overrides only what it is about. */
function serviceOptions(overrides: Partial<RunCommandOptions> = {}): RunCommandOptions {
  return {
    fileReads: fileReads.current,
    processes: testProcesses(),
    workspace: temp.workspace,
    permissions: testPermissions({ mode: 'allow_all' }),
    ...overrides,
  };
}

function setup() {
  tasks = new TaskRegistry();

  const owner = new SessionRegistry().startMain({ title: 'Main' });

  return toolRunner([createStartServiceTool(serviceOptions({ tasks }))], owner);
}

describe('start_service', () => {
  it('starts a service that never holds a run open', async () => {
    const run = setup();
    const start = vi.spyOn(tasks, 'start');
    const result = await run('s1', 'start_service', { command: 'sleep 5' });

    expect(result.role === 'tool' && result.content).toContain('Started background task t1');
    expect(result.role === 'tool' && result.content).toContain('does not keep this prompt alive');
    expect(start.mock.calls[0]?.[0]).toMatchObject({ backgroundKind: 'service' });
    expect(tasks.runningCount).toBe(1);
    expect(tasks.hasPendingTasks()).toBe(false);
  });

  it('has no background or backgroundKind input to choose a policy with', () => {
    const tool = createStartServiceTool(serviceOptions({ tasks: new TaskRegistry() }));

    expect(Object.keys(tool.inputSchema.shape).sort()).toEqual(['command', 'cwd']);
  });

  it('asks before running a command the user has not allowed', async () => {
    tasks = new TaskRegistry();
    const result = await runTool({
      tools: [createStartServiceTool(serviceOptions({ permissions: testPermissions(), tasks }))],
      call: {
        id: callIdSchema.parse('s2'),
        name: 'start_service',
        input: { description: 'serve', command: 'sleep 5' },
      },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(tasks.list()).toEqual([]);
  });

  it.each([
    { name: 'start_service', input: { command: 'true' } },
    { name: 'run_command', input: { command: 'true', background: true } },
  ])('$name refuses a background start outside a session, before the approval', async (call) => {
    tasks = new TaskRegistry();
    const permissions = testPermissions({ mode: 'allow_all' });
    const read = vi.spyOn(permissions, 'read');
    const options = serviceOptions({ permissions, tasks });
    const run = toolRunner([createStartServiceTool(options), createRunCommandTool(options)]);
    const result = await run('s4', call.name, call.input);

    expect(result).toMatchObject({ isError: true });
    expect(result.role === 'tool' && result.content).toContain(
      'only works inside an agent session',
    );
    expect(read).not.toHaveBeenCalled();
    expect(tasks.list()).toEqual([]);
  });

  it('is refused when the harness has no task registry', async () => {
    tasks = new TaskRegistry();
    const permissions = testPermissions({ mode: 'allow_all' });
    const read = vi.spyOn(permissions, 'read');
    const run = toolRunner([createStartServiceTool(serviceOptions({ permissions }))]);
    const result = await run('s3', 'start_service', { command: 'true' });

    expect(result).toMatchObject({ isError: true });
    expect(result.role === 'tool' && result.content).toContain('not enabled');
    // Refused before the approval step, so no one is asked about a command that could not start.
    expect(read).not.toHaveBeenCalled();
  });
});
