import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, describeCall, runTool, toDefinition } from '../tool.service.js';

const signal = new AbortController().signal;

const echo = defineTool({
  name: 'echo',
  description: 'Echoes text back',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ input }) => JSON.stringify(input),
});

describe('call description', () => {
  it("is added to every tool's JSON schema as a required field, listed first", () => {
    const schema = toDefinition(echo).inputSchema as { properties: object; required: string[] };

    expect(Object.keys(schema.properties)).toEqual(['description', 'text']);
    expect(schema.required).toEqual(['description', 'text']);
  });

  it('is stripped before the tool runs', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: '1', name: 'echo', input: { description: 'echoing hi', text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: false, content: '{"text":"hi"}' });
  });

  it('is required; a missing one goes back to the model as an error', async () => {
    const result = await runTool({
      tools: [echo],
      call: { id: '1', name: 'echo', input: { text: 'hi' } },
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('description');
  });

  it('is read from the call for the UI, falling back to the tool name', () => {
    expect(
      describeCall({ id: '1', name: 'echo', input: { description: 'echoing hi', text: 'hi' } }),
    ).toBe('echoing hi');
    expect(describeCall({ id: '1', name: 'echo', input: { text: 'hi' } })).toBe('echo');
    expect(describeCall({ id: '1', name: 'echo', input: 'not json' })).toBe('echo');
  });

  it('is reserved: tools cannot define their own description field', () => {
    expect(() =>
      defineTool({
        name: 'bad',
        description: '',
        inputSchema: z.object({ description: z.string() }),
        execute: async () => '',
      }),
    ).toThrow('"description" is reserved');
  });
});
