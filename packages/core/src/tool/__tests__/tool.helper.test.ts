import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { echoTool as echo } from '../../testing/echo-tool.fake.js';
import { runTool } from '../tool.helper.js';
import { defineTool } from '../tool.utils.js';
import type { ToolArtifact } from '@sheavly/protocol/event/event.types';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const signal = new AbortController().signal;
const callId = callIdSchema.parse('1');

describe('runTool', () => {
  it('strips the call description before the tool runs', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: callId, name: 'echo', input: { description: 'echoing hi', text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: false, content: '{"text":"hi"}' });
  });

  it('requires the call description; a missing one goes back to the model as an error', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: callId, name: 'echo', input: { text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Invalid input for echo');
    expect(result.content).toContain('description');
  });

  it('answers an unknown tool with an error result, without throwing', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: callId, name: 'nope', input: {} },
      signal,
    });

    expect(result).toMatchObject({ isError: true, content: 'Unknown tool: nope' });
  });
});

describe('runTool: artifacts', () => {
  const call = { id: callId, name: 'parse', input: { description: 'parsing' } };
  const tool = (artifacts?: ToolArtifact[]) =>
    defineTool({
      name: 'parse',
      description: '',
      inputSchema: z.object({}),
      execute: async () => ({ content: 'Parsed 2 rows', ...(artifacts && { artifacts }) }),
    });

  it("are passed on as the tool returned them, apart from the history message's fields", async () => {
    const artifacts = [{ kind: 'table', columns: ['a', 'b'], rows: 2 }];
    const result = await runTool({ tools: [tool(artifacts)], call, signal });

    expect(result).toMatchObject({
      role: 'tool',
      toolCallId: '1',
      content: 'Parsed 2 rows',
      isError: false,
      artifacts,
    });
  });

  it('are left out when there are none', async () => {
    expect(await runTool({ tools: [tool()], call, signal })).not.toHaveProperty('artifacts');
    expect(await runTool({ tools: [tool([])], call, signal })).not.toHaveProperty('artifacts');
  });
});
