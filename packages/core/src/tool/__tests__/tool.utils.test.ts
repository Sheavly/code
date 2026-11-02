import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { echoTool as echo } from '../../testing/echo-tool.fake.js';
import { defineTool, toDefinition } from '../tool.utils.js';

describe('toDefinition', () => {
  it("adds the call description to the tool's JSON schema as a required field, listed first", () => {
    const schema = toDefinition(echo).inputSchema as { properties: object; required: string[] };

    expect(Object.keys(schema.properties)).toEqual(['description', 'text']);
    expect(schema.required).toEqual(['description', 'text']);
  });
});

describe('defineTool', () => {
  it('reserves `description`: tools cannot define their own description field', () => {
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
