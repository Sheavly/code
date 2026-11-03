import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@sheavly/core/message/message.types';
import type { Provider } from '@sheavly/core/provider/provider.types';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { runAgent, streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createRunCommandTool } from '../run-command.tool.js';
import type { ApprovalResponse, ApprovalUpdate } from '@sheavly/protocol/approval/approval.types';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import type { Message } from '@sheavly/protocol/message/message.types';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const c1 = callIdSchema.parse('c1');

/**
 * The approval flow end to end: a UI subscribes to the registry, the tool waits for its answer,
 * and the loop carries the outcome back to the model.
 */
const temp = useTempWorkspace({
  prefix: 'run-command-approval-',
  files: { 'src/a.ts': 'a' },
  outside: { 'secret.txt': 'outside' },
});

const tool = (approvals: ApprovalRegistry, allowList = ['ls *']) =>
  createRunCommandTool({
    processes: testProcesses(),
    workspace: temp.workspace,
    allowList,
    approvals,
  });

/** The model asks for `command` once, then ends. Records what each model call was sent. */
function oneCommandModel(command: string): { provider: Provider; sent: Message[][] } {
  const sent: Message[][] = [];
  const turns: StreamEvent[][] = [
    [
      {
        type: 'tool_call',
        call: { id: c1, name: 'run_command', input: { description: 'running it', command } },
      },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [{ type: 'done', stopReason: 'end_turn' }],
  ];

  return {
    sent,
    provider: {
      async *stream(request) {
        sent.push([...request.messages]);
        yield* turns[sent.length - 1] ?? [];
      },
    },
  };
}

/** A UI that answers every request with `response` after `delayMs`, recording every update. */
function laterUi(params: {
  approvals: ApprovalRegistry;
  response: ApprovalResponse;
  delayMs: number;
}) {
  const { approvals, response, delayMs } = params;
  const updates: ApprovalUpdate[] = [];

  approvals.subscribe((update) => {
    updates.push(update);
    if (update.type !== 'approval_requested') return;
    setTimeout(() => {
      approvals.respond({ id: update.request.id, response });
    }, delayMs);
  });

  return updates;
}

const toolMessage = (messages: Message[]) => messages.find((message) => message.role === 'tool');

/** Runs one `command` through the loop with a UI answering `response`; returns what it saw. */
async function runWithAnswer(params: { command: string; response: ApprovalResponse }) {
  const approvals = new ApprovalRegistry();
  const updates = laterUi({ approvals, response: params.response, delayMs: 0 });
  const { provider, sent } = oneCommandModel(params.command);

  await runAgent({
    provider,
    tools: [tool(approvals)],
    messages: [{ role: 'user', content: 'go' }],
  });

  // The model's second call carries the tool result: exactly what the agent was told.
  return { updates, result: toolMessage(sent[1] ?? []) };
}

describe('approval flow through the loop', () => {
  it('approve: the command runs, and the model sees its output', async () => {
    const { updates, result } = await runWithAnswer({
      command: 'ls ..',
      response: { decision: 'approve' },
    });

    expect(updates.map((update) => update.type)).toEqual([
      'approval_requested',
      'approval_resolved',
    ]);
    expect(result).toMatchObject({ isError: false });
    expect(result?.content).toContain('secret.txt');
  });

  it('skip: the command does not run, and the model is told not to retry', async () => {
    const { result } = await runWithAnswer({
      command: 'ls ../secret.txt',
      response: { decision: 'skip' },
    });

    expect(result).toMatchObject({ isError: true });
    expect(result?.content).toContain('The user skipped this command: ls ../secret.txt');
    expect(result?.content).toContain('Do not retry it without asking the user.');
    expect(result?.content).not.toContain('[exit code'); // the command never ran
  });

  it('skip with a message: the command does not run, and the steering text reaches the model', async () => {
    const { result } = await runWithAnswer({
      command: 'ls ..',
      response: { decision: 'skip_with_message', message: 'only look inside src' },
    });

    expect(result).toMatchObject({ isError: true });
    expect(result?.content).toContain('Instead, the user says: only look inside src');
    expect(result?.content).not.toContain('secret.txt');
  });

  it('a UI answering later, mid-run, does not hang the loop', async () => {
    const approvals = new ApprovalRegistry();
    const events: AgentEvent[] = [];

    laterUi({ approvals, response: { decision: 'approve' }, delayMs: 50 });
    const { provider } = oneCommandModel('ls ..');

    await runAgent({
      provider,
      tools: [tool(approvals)],
      messages: [{ role: 'user', content: 'go' }],
      onEvent: (event) => events.push(event),
    });

    const types = events.map((event) => event.type);

    // The turn ended while the tool was still waiting; its result came once the UI answered.
    expect(types.indexOf('turn_end')).toBeLessThan(types.indexOf('tool_result'));
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'completed' });
  });

  it('an interrupted run cancels the wait, tells the UI, and the command never runs', async () => {
    const approvals = new ApprovalRegistry();
    const updates: ApprovalUpdate[] = [];
    const interrupt = new AbortController();

    approvals.subscribe((update) => {
      updates.push(update);
      if (update.type === 'approval_requested') interrupt.abort(); // the user hits Ctrl+C instead
    });
    const { provider } = oneCommandModel('ls ..');
    const events: AgentEvent[] = [];

    for await (const event of streamAgent({
      provider,
      tools: [tool(approvals)],
      messages: [{ role: 'user', content: 'go' }],
      signal: interrupt.signal,
    })) {
      events.push(event);
    }

    expect(updates.map((update) => update.type)).toEqual([
      'approval_requested',
      'approval_cancelled',
    ]);
    expect(approvals.pending()).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'interrupted' });
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      message: { isError: true, content: expect.stringContaining('Interrupted') as string },
    });
  });
});

describe('approval flow without a UI', () => {
  it('nothing listening: the command is refused at once and never runs', async () => {
    const marker = path.join(temp.base, 'touched');
    const result = await runTool({
      tools: [tool(new ApprovalRegistry(), ['touch *'])],
      call: {
        id: callIdSchema.parse('1'),
        name: 'run_command',
        input: { description: 'touching', command: `touch ${marker}` },
      },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain("Command refused, it needs the user's approval");
    expect(existsSync(marker)).toBe(false);
  });
});
