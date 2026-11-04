import type { StreamEvent } from '@sheavly/core/message/message.types';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { ConversationStore } from '@sheavly/core/store/store.types';
import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { Conversations } from '@sheavly/host/conversations/conversations.service';
import { createHarness } from '@sheavly/host/host/host.helper';
import { reviewSkill } from '@sheavly/host/testing/skills.fake';
import { twoModelRun } from '@sheavly/host/testing/run.fake';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { blockTool } from '@sheavly/runtime/testing/block-tool.fake';
import { routedProvider } from '@sheavly/testing/provider/routed-provider.fake';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { z } from 'zod';
import { createApiApp } from '../api/api.helper.js';
import { TEST_TOKEN } from './testing.constants.js';
import type { TestRequest } from './testing.types.js';

/** Test-only: a turn that answers with `text`. */
export const reply =
  (text: string): Script =>
  () =>
    [
      { type: 'text_delta', text },
      { type: 'done', stopReason: 'end_turn' },
    ] satisfies StreamEvent[];

/** Test-only: a tool that asks for approval before it runs, like run_command's risky arguments. */
function askingTool(approvals: ReturnType<typeof createHarness>['approvals']) {
  return defineTool({
    name: 'ask',
    description: 'Asks the user first',
    inputSchema: z.object({}),
    execute: async ({ context, signal }) =>
      (
        await approvals.request({
          callId: context.callId,
          sessionId: context.session?.id,
          tool: 'ask',
          command: 'rm -rf build',
          concerns: [],
          signal,
        })
      ).decision,
  });
}

/**
 * Test-only: the backend's API on conversations of a scripted model, each prompt's first user
 * message picking its script (`routedProvider`), with a blocking and an asking tool. `request`
 * calls it in-process with the token, as a client would. With a `store`, the conversations are
 * kept in it, wired as the backend wires them.
 */
export function testApi(scripts: Record<string, Script[]>, store?: ConversationStore) {
  const conversations = new Conversations({
    ...(store && { store }),
    create: async ({ messages, storage }) => {
      const harness = createHarness({
        provider: routedProvider(scripts),
        title: 'Chat',
        ...(storage && { entries: storage.entries, resume: storage.resume }),
      });

      return {
        harness,
        conversation: createConversation({
          harness,
          run: streamAgent,
          tools: [blockTool, askingTool(harness.approvals)],
          messages: messages ?? [],
          ...(storage && {
            keepHistory: storage.keepHistory,
            resumed: storage.resume !== undefined,
          }),
        }),
        skills: reviewSkill,
        run: twoModelRun(),
      };
    },
  });
  const app = createApiApp({ conversations, token: TEST_TOKEN });
  const request = async (path: string, init: TestRequest = {}) =>
    app.request(path, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });

  return { app, conversations, request, start: () => startConversation(request) };
}

/** Test-only: starts a conversation through the API, as a client does, and returns its id. */
async function startConversation(request: (path: string, init?: TestRequest) => Promise<Response>) {
  const response = await request('/conversations', { method: 'POST', body: {} });

  if (response.status !== 201) throw new Error(`starting failed: ${String(response.status)}`);

  return ((await response.json()) as { id: string }).id;
}
