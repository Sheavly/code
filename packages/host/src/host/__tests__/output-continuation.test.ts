import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { fakeFetchSequence } from '@sheavly/testing/fetch/fake-fetch.fake';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
import { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
import { TEST_REQUEST } from '@sheavly/providers/testing/request.constants';
import type { AgentEvent } from '@sheavly/protocol/event/event.types';
import { formatHarnessNotice } from '@sheavly/core/notice/notice.utils';

function completedMessagesReply() {
  return [
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Done.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];
}

describe('provider output continuation through the real loop', () => {
  it('recovers an open Claude tool block at max_tokens without executing its partial arguments', async () => {
    const toolStart = (id: string) => ({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id, name: 'apply' },
    });
    const { fetch, requests } = fakeFetchSequence({
      complete: false,
      responses: [
        [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: 'Writing the design.' },
          },
          { type: 'content_block_stop', index: 0 },
          toolStart('unfinished'),
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"description":' },
          },
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
          { type: 'message_stop' },
        ],
        [
          toolStart('complete'),
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"description":"Apply once"}' },
          },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
          { type: 'message_stop' },
        ],
        completedMessagesReply(),
      ],
    });
    const applied: string[] = [];
    const events: AgentEvent[] = [];
    const result = await runSession({
      provider: createDefaultRegistry({ fetch }).create('azure-anthropic', {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/anthropic',
        deployment: 'claude-sonnet-5-5',
        request: TEST_REQUEST,
      }),
      tools: [
        defineTool({
          name: 'apply',
          description: 'Apply a change',
          inputSchema: z.object({}),
          execute: async ({ context }) => {
            applied.push(context.callId);

            return 'Applied.';
          },
        }),
      ],
      messages: [{ role: 'user', content: 'Write the design.' }],
      onEvent: (event) => events.push(event),
    });

    expect(result.reason).toBe('completed');
    expect(applied).toEqual(['complete']);
    expect(requests).toHaveLength(3);
    expect(
      events.filter(
        (event) => event.type === 'harness_notice' && event.notice.kind === 'output-continuation',
      ),
    ).toHaveLength(1);
    expect(result.messages[1]).toMatchObject({ content: 'Writing the design.', toolCalls: [] });
  });
  it('replays signed Claude thinking and completed tools at high effort after an output cutoff', async () => {
    const thinking = { type: 'thinking', thinking: 'Planning.', signature: 'signed-thinking' };
    const { fetch, requests } = fakeFetchSequence({
      complete: false,
      responses: [
        [
          { type: 'content_block_start', index: 0, content_block: thinking },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'c1', name: 'apply' },
          },
          {
            type: 'content_block_delta',
            index: 1,
            // Even an empty tool schema gets the harness's required call description.
            delta: { type: 'input_json_delta', partial_json: '{"description":"Apply once"}' },
          },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
          { type: 'message_stop' },
        ],
        completedMessagesReply(),
      ],
    });
    let effects = 0;
    const apply = defineTool({
      name: 'apply',
      description: 'Apply the change',
      inputSchema: z.object({}),
      execute: async () => {
        effects++;

        return 'Applied once.';
      },
    });
    const providers = new ProviderSwitch().add(
      'claude',
      createDefaultRegistry({ fetch }).create('azure-anthropic', {
        apiKey: 'test-key',
        baseUrl: 'https://example.test/anthropic',
        deployment: 'claude-sonnet-5-5',
        request: TEST_REQUEST,
      }),
    );

    providers.setMode({ name: 'claude', mode: 'high' });
    const result = await runSession({
      provider: providers,
      tools: [apply],
      instructions: 'Apply once, then explain.',
      messages: [{ role: 'user', content: 'Make the change.' }],
    });

    expect(result.reason).toBe('completed');
    expect(effects).toBe(1);
    expect(requests).toHaveLength(2);

    for (const request of requests) {
      expect(request.body).toMatchObject({
        max_tokens: 32768,
        system: 'Apply once, then explain.',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
    }

    expect(requests[1]?.body.messages).toMatchObject([
      { role: 'user', content: [{ type: 'text', text: 'Make the change.' }] },
      { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'c1', name: 'apply' }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'Applied once.' },
          { type: 'text', text: formatHarnessNotice({ kind: 'output-continuation', attempt: 1 }) },
        ],
      },
    ]);
  });

  it('continues a Responses API incomplete reply without retrying the original request', async () => {
    const { fetch, requests } = fakeFetchSequence({
      complete: false,
      responses: [
        [
          { type: 'response.output_text.delta', delta: 'Partial.' },
          {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'max_output_tokens' } },
          },
        ],
        [
          { type: 'response.output_text.delta', delta: 'Finished.' },
          { type: 'response.completed', response: {} },
        ],
      ],
    });
    const result = await runSession({
      provider: createDefaultRegistry({ fetch }).create('openai', {
        apiKey: 'test-key',
        model: 'gpt-6.1-sol',
        request: TEST_REQUEST,
      }),
      tools: [],
      messages: [{ role: 'user', content: 'Explain.' }],
    });

    expect(result.reason).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body.input).toMatchObject([
      { role: 'user', content: 'Explain.' },
      { role: 'assistant', content: 'Partial.' },
      { role: 'user', content: formatHarnessNotice({ kind: 'output-continuation', attempt: 1 }) },
    ]);
  });
});
