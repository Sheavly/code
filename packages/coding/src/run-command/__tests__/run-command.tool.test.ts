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
import { testPermissions } from '../../testing/permissions.fake.js';

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

type RunOptions = Partial<Omit<RunCommandOptions, 'workspace' | 'processes'>>;

const toolWith = (options: RunOptions = {}) =>
  createRunCommandTool({
    processes: testProcesses(),
    workspace,
    permissions: testPermissions(),
    ...options,
  });

const run = (command: string, options: RunOptions = {}, description = `running ${command}`) =>
  runTool({
    tools: [toolWith(options)],
    call: { id: callId, name: 'run_command', input: { description, command } },
    signal,
  });

const allowAll = () => ({ permissions: testPermissions({ mode: 'allow_all' }) });

describe('run_command with what the user has allowed', () => {
  it('runs a built-in command in the workspace root', async () => {
    const result = await run('pwd');

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('[exit code 0]');
    expect(result.content).toContain(workspace.root);
  });

  it('runs a command the user allowed, with arguments for a * entry', async () => {
    const permissions = testPermissions({ allow: ['echo *'] });
    const result = await run(`echo "hello world"`, { permissions });

    expect(result.content).toContain('hello world');
  });

  it('refuses a command that is not allowed when no one can be asked, without running it', async () => {
    await writeFile(path.join(root, 'keep.txt'), 'x');
    const result = await run('rm keep.txt');

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("Command refused, it needs the user's approval: rm keep.txt");
    expect(result.content).toContain('rm keep.txt: is not allowed yet');
    expect(existsSync(path.join(root, 'keep.txt'))).toBe(true);
  });

  it('refuses a chain when any command in it is not allowed, and runs none of it', async () => {
    const marker = path.join(root, 'first-ran.txt');
    const result = await run(`touch ${marker} && rm keep.txt`, {
      permissions: testPermissions({ allow: ['touch *'] }),
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('rm keep.txt: is not allowed yet');
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses what the parser cannot carry out, saying why', async () => {
    const result = await run('echo hi > out.txt', allowAll());

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Command rejected (redirects (< >) are not supported)');
    expect(existsSync(path.join(root, 'out.txt'))).toBe(false);
  });

  it('reports non-zero exit codes', async () => {
    const result = await run('ls does-not-exist');

    expect(result.content).toMatch(/\[exit code [1-9]\d*\]/);
  });

  it('runs allowed commands joined by a pipe or a list', async () => {
    const permissions = testPermissions({ allow: ['printf *', 'head *'] });
    const result = await run(`printf 'a\\nb\\nc\\n' | head -n 2 && pwd`, { permissions });

    expect(result.content).toContain('a\nb\n');
    expect(result.content).not.toContain('c\n');
    expect(result.content).toContain(workspace.root);
  });
});

describe('run_command in allow_all mode', () => {
  it('runs any command, and chains them without a shell', async () => {
    const result = await run('echo one && echo two', allowAll());

    expect(result).toMatchObject({ isError: false });
    expect(result.content).toContain('one\ntwo');
  });

  it('does not pass secret-looking environment variables to commands', async () => {
    process.env.FAKE_TEST_API_KEY = 'should-not-leak';

    try {
      const result = await run('env', allowAll());

      expect(result.content).toContain('PATH=');
      expect(result.content).not.toContain('should-not-leak');
    } finally {
      delete process.env.FAKE_TEST_API_KEY;
    }
  });

  it('does not expand what a shell would', async () => {
    const result = await run(`echo '$HOME' '\`id\`'`, allowAll());

    expect(result.content).toContain('$HOME `id`');
  });

  it('kills commands that run past the timeout', async () => {
    const result = await run('sleep 5', { ...allowAll(), timeoutMs: 100 });

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
      tools: [toolWith(allowAll())],
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
      tools: [toolWith(allowAll())],
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
      tools: [toolWith()],
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
