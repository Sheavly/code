import { describe, expect, it } from 'vitest';
import { echoTool as echo } from '../../testing/echo-tool.fake.js';
import { runTool } from '../tool.helper.js';

const signal = new AbortController().signal;

describe('runTool', () => {
  it('strips the call description before the tool runs', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: '1', name: 'echo', input: { description: 'echoing hi', text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: false, content: '{"text":"hi"}' });
  });

  it('requires the call description; a missing one goes back to the model as an error', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: '1', name: 'echo', input: { text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Invalid input for echo');
    expect(result.content).toContain('description');
  });

  it('answers an unknown tool with an error result, without throwing', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: '1', name: 'nope', input: {} },
      signal,
    });

    expect(result).toMatchObject({ isError: true, content: 'Unknown tool: nope' });
  });
});
