/**
 * The real `coding` extension asks for approval through the same scoped service and grants as any
 * third party. What the user's UI hears is what it heard before coding left the harness: the
 * tool's own name, the command exactly as the model gave it, and the options and keeps that let
 * the user allow it for the session or for good. Fails if coding stops declaring either grant.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { ApprovalResponse } from '@sheavly/protocol/approval/approval.types';
import { calls, say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { listenAndAnswer } from '../../testing/approval-ui.fake.js';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { recordingPermissions } from '../../testing/permissions.fake.js';
import { untilSettled } from '../../testing/settled.fake.js';

const open = useBackendRuns();
const COMMAND = 'sleep 0.01 && echo parity-ran';

/** A line of `count` distinct commands no allow list knows, so each is its own concern. */
const lineOfUnlisted = (count: number) =>
  Array.from({ length: count }, (_unused, index) => `unlisted${String(index)} x`).join(' && ');

/** Runs one prompt whose model calls `tool` with `command`, answering what the UI hears with `answer`. */
async function runTool(params: { tool: string; answer: ApprovalResponse; command?: string }) {
  const { tool, answer, command = COMMAND } = params;
  const permissions = recordingPermissions();
  const requests: ProviderRequest[] = [];
  const harness = await open({
    extensions: [],
    permissions,
    scripts: {
      go: [calls(toolCall({ id: 'cmd', name: tool, input: { command } })), say('done')],
    },
    onModelCall: (request) => requests.push(request),
  });
  const heard = listenAndAnswer(harness, answer);
  const conversation = createConversation({
    harness,
    tools: harness.tools,
    hooks: harness.hooks,
    run: streamAgent,
  });

  try {
    for await (const _event of conversation.send('go'));
    await untilSettled({ harness, conversation });
  } finally {
    await conversation.close();
  }

  const result = requests
    .flatMap((request) => request.messages)
    .find((message) => message.role === 'tool' && message.toolCallId === 'cmd');

  return { heard, permissions, result };
}

describe('coding asking the user to approve a command in ask mode', () => {
  it('lets the UI hear run_command with the command unprefixed, every option and the keeps', async () => {
    const { heard, result } = await runTool({
      tool: 'run_command',
      answer: { decision: 'approve' },
    });

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      tool: 'run_command',
      command: COMMAND,
      keeps: ['sleep *', 'echo *'],
    });
    expect(heard[0]?.command).not.toContain('[coding]');
    expect(heard[0]?.options).toEqual(
      expect.arrayContaining(['approve', 'always_allow', 'allow_session', 'skip']),
    );
    expect(result).toMatchObject({ isError: false });
    expect(result?.content).toContain('parity-ran');
  });

  it('keeps the proposed entries and runs the command when the user answers always_allow', async () => {
    const { heard, permissions, result } = await runTool({
      tool: 'run_command',
      answer: { decision: 'always_allow' },
    });

    expect(permissions.allowed).toEqual(heard[0]?.keeps);
    expect(permissions.allowed).toEqual(['sleep *', 'echo *']);
    expect(permissions.sessionAllowed).toEqual([]);
    expect(result).toMatchObject({ isError: false });
    expect(result?.content).toContain('parity-ran');
  });

  it('shares the proposed entries for the session and runs the command when the user answers allow_session', async () => {
    const { heard, permissions, result } = await runTool({
      tool: 'run_command',
      answer: { decision: 'allow_session' },
    });

    expect(permissions.sessionAllowed).toEqual(heard[0]?.keeps);
    expect(permissions.allowed).toEqual([]);
    expect(result).toMatchObject({ isError: false });
  });

  it('shows a 20-step line with every concern unchanged', async () => {
    const command = lineOfUnlisted(20);
    const { heard } = await runTool({ tool: 'run_command', answer: { decision: 'skip' }, command });

    expect(heard[0]?.concerns).toHaveLength(20);
    expect(heard[0]?.concerns.map(({ argument }) => argument)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => `unlisted${String(index)} x`),
    );
    expect(heard[0]?.concerns.every(({ reason }) => reason === 'is not allowed yet')).toBe(true);
  });

  it('shows a 60-command line as 49 concerns and one that counts the 11 not shown', async () => {
    const command = lineOfUnlisted(60);
    const { heard } = await runTool({ tool: 'run_command', answer: { decision: 'skip' }, command });
    const concerns = heard[0]?.concerns ?? [];

    expect(concerns).toHaveLength(50);
    expect(concerns[48]).toEqual({ argument: 'unlisted48 x', reason: 'is not allowed yet' });
    expect(concerns[49]).toEqual({
      argument: '+11 more',
      reason: 'not shown here: the request had 60 concerns',
    });
  });

  it('asks about a line with more bases than may be kept, offering nothing to keep instead of failing', async () => {
    const { heard, permissions, result } = await runTool({
      tool: 'run_command',
      answer: { decision: 'skip' },
      command: lineOfUnlisted(21),
    });

    expect(heard).toHaveLength(1);
    expect(heard[0]?.concerns).toHaveLength(21);
    expect(heard[0] && 'keeps' in heard[0]).toBe(false);
    expect(heard[0]?.options).toEqual(['approve', 'skip', 'skip_with_message']);
    expect(permissions.allowed).toEqual([]);
    expect(result?.content).toContain('The user skipped this command');
  });

  it('names start_service when that tool asks, not run_command', async () => {
    const { heard } = await runTool({ tool: 'start_service', answer: { decision: 'skip' } });

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ tool: 'start_service', command: COMMAND });
  });
});
