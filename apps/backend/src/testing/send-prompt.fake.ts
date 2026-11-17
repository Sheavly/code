import { createConversation } from '@sheavly/host/conversation/conversation.helper';
import { streamAgent } from '@sheavly/loop/stream-agent/stream-agent.helper';
import type { BackendHarness } from '../harness/harness.types.js';
import { untilSettled } from './settled.fake.js';

/**
 * Runs one prompt through the harness's own tools and hooks in the real loop, waits for the
 * background work it started to finish, and closes the conversation.
 */
export async function sendPromptAndSettle(params: {
  harness: BackendHarness;
  prompt: string;
}): Promise<void> {
  const { harness, prompt } = params;
  const conversation = createConversation({
    harness,
    run: streamAgent,
    tools: harness.tools,
    hooks: harness.hooks,
  });

  for await (const _event of conversation.send(prompt));
  await untilSettled({ harness, conversation });
  await conversation.close();
}
