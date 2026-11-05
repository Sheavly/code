import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { createRunCommandTool } from '../run-command.tool.js';
import type { RunCommandOptions } from '../run-command.types.js';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

let root: string;
let workspace: Workspace;
const signal = new AbortController().signal;
const callId = callIdSchema.parse('1');

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'run-command-test-'));
  workspace = await Workspace.open(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = (
  command: string,
  options: Omit<RunCommandOptions, 'workspace' | 'processes'> = {},
  description = `running ${command}`,
) =>
  runTool({
    tools: [createRunCommandTool({ processes: testProcesses(), workspace, ...options })],
    call: { id: callId, name: 'run_command', input: { description, command } },
    signal,
  });

describe('run_command with the allow list', () => {
  it('runs an allow-listed command in the workspace root', async () => {
    const result = await run('pwd', { allowList: ['pwd'] });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('[exit code 0]');
    expect(result.content).toContain(workspace.root);
  });

  it('passes arguments for wildcard entries', async () => {
    const result = await run(`echo "hello world"`, { allowList: ['echo *'] });

    expect(result.content).toContain('hello world');
  });

  it('rejects a command that is not on the list, without running it', async () => {
    await writeFile(path.join(root, 'keep.txt'), 'x');
    const result = await run('rm keep.txt', { allowList: ['pwd'] });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Command not in allow list: rm keep.txt');
    expect(result.content).toContain('Allowed: pwd');
    expect(existsSync(path.join(root, 'keep.txt'))).toBe(true);
  });

  it('rejects chaining a forbidden command onto an allowed one', async () => {
    await writeFile(path.join(root, 'keep2.txt'), 'x');
    const result = await run('echo hi; rm keep2.txt', { allowList: ['echo *'] });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('chaining commands');
    expect(existsSync(path.join(root, 'keep2.txt'))).toBe(true);
  });

  it('reports non-zero exit codes', async () => {
    const result = await run('ls does-not-exist', { allowList: ['ls *'] });

    expect(result.content).toMatch(/\[exit code [1-9]\d*\]/);
  });
});

describe('run_command with skipAllowList', () => {
  it('permits commands that are not on the list, through a real shell', async () => {
    const result = await run('echo one && echo two', { allowList: [], skipAllowList: true });

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('one\ntwo');
  });

  it('does not pass secret-looking environment variables to commands', async () => {
    process.env.FAKE_TEST_API_KEY = 'should-not-leak';

    try {
      const result = await run('echo "[$FAKE_TEST_API_KEY]"', { skipAllowList: true });

      expect(result.content).toContain('[]');
      expect(result.content).not.toContain('should-not-leak');
    } finally {
      delete process.env.FAKE_TEST_API_KEY;
    }
  });

  it('kills commands that run past the timeout', async () => {
    const result = await run('sleep 5', { skipAllowList: true, timeoutMs: 100 });

    expect(result.content).toContain('[timed out]');
  });

  it('is killed with its process group when the run is interrupted', async () => {
    const marker = path.join(root, 'should-not-exist.txt');
    const controller = new AbortController();
    const provider = scriptedProvider([
      [
        {
          type: 'tool_call',
          call: {
            id: callIdSchema.parse('c1'),
            name: 'run_command',
            input: { description: 'slow', command: `sleep 5 && touch ${marker}` },
          },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);

    const started = performance.now();

    setTimeout(() => controller.abort(), 100);
    const messages = await runAgent({
      provider,
      tools: [createRunCommandTool({ processes: testProcesses(), workspace, skipAllowList: true })],
      messages: [{ role: 'user', content: 'go' }],
      signal: controller.signal,
    });

    expect(performance.now() - started).toBeLessThan(2_000); // didn't wait out the sleep
    expect(messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1', isError: true });
    expect((messages.at(-1) as { content: string }).content).toContain('Interrupted');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(marker)).toBe(false); // the process group was killed, not just abandoned
  });
});

describe('run_command description', () => {
  it('is required: a call without one is rejected and nothing runs', async () => {
    const result = await runTool({
      tools: [createRunCommandTool({ processes: testProcesses(), workspace, skipAllowList: true })],
      call: { id: callId, name: 'run_command', input: { command: 'touch marker.txt' } },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('description');
    expect(existsSync(path.join(root, 'marker.txt'))).toBe(false);
  });

  it('is reported on the tool_call event for the UI to display', async () => {
    const provider = scriptedProvider([
      [
        {
          type: 'tool_call',
          call: {
            id: callId,
            name: 'run_command',
            input: { description: 'checking where we are', command: 'pwd' },
          },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'done', stopReason: 'end_turn' }],
    ]);

    const events: AgentEvent[] = [];

    await runAgent({
      provider,
      tools: [createRunCommandTool({ processes: testProcesses(), workspace, allowList: ['pwd'] })],
      messages: [{ role: 'user', content: 'where are we?' }],
      onEvent: (event) => events.push(event),
    });

    expect(events.find((e) => e.type === 'tool_call_started')).toMatchObject({
      description: 'checking where we are',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      message: { isError: false },
    });
  });
});
