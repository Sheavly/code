import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeCall, withDescription } from '../tool.validator.js';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';

const callId = callIdSchema.parse('1');

describe('withDescription', () => {
  const schema = withDescription(z.object({ text: z.string() }));

  it('preserves the shared model-visible description wording', () => {
    expect(z.toJSONSchema(schema)).toMatchObject({
      properties: {
        description: {
          type: 'string',
          minLength: 1,
          maxLength: 120,
          description:
            "Short plain-language summary of what you are doing, e.g. 'reading index.ts'. Shown to the user.",
        },
      },
    });
  });

  it('accepts input with a description and the tool fields', () => {
    expect(schema.parse({ description: 'echoing hi', text: 'hi' })).toEqual({
      description: 'echoing hi',
      text: 'hi',
    });
  });

  it('rejects a missing, empty or too long description', () => {
    expect(schema.safeParse({ text: 'hi' }).success).toBe(false);
    expect(schema.safeParse({ description: '', text: 'hi' }).success).toBe(false);
    expect(schema.safeParse({ description: 'x'.repeat(121), text: 'hi' }).success).toBe(false);
  });

  it("still rejects input the tool's own schema rejects", () => {
    expect(schema.safeParse({ description: 'echoing', text: 1 }).success).toBe(false);
  });
});

describe('describeCall', () => {
  it('reads the description off a call, falling back to the tool name', () => {
    expect(
      describeCall({ id: callId, name: 'echo', input: { description: 'echoing hi', text: 'hi' } }),
    ).toBe('echoing hi');
    expect(describeCall({ id: callId, name: 'echo', input: { text: 'hi' } })).toBe('echo');
    expect(describeCall({ id: callId, name: 'echo', input: { description: '' } })).toBe('echo');
    expect(describeCall({ id: callId, name: 'echo', input: 'not json' })).toBe('echo');
  });
});
