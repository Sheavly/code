import { describe, expect, it } from 'vitest';
import { responsesEventSchema } from '../responses.validator.js';

describe('responsesEventSchema', () => {
  it('accepts the event types the provider reads', () => {
    for (const event of [
      { type: 'response.output_text.delta', delta: 'Hi' },
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
      },
      {
        type: 'response.output_item.done',
        item: { type: 'reasoning', encrypted_content: 'enc', id: 'rs_1' },
      },
      { type: 'response.completed' },
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'x' } } },
      { type: 'response.failed', response: { error: { message: 'boom' } } },
      { type: 'error', error: { message: 'rate limited', code: 'too_many_requests' } },
    ]) {
      expect(responsesEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('keeps every field of a reasoning item, so it can be resent exactly', () => {
    const item = { type: 'reasoning', encrypted_content: 'enc', id: 'rs_1', summary: [] };
    const parsed = responsesEventSchema.parse({ type: 'response.output_item.done', item });

    expect(parsed).toEqual({ type: 'response.output_item.done', item });
  });

  it('rejects event types it does not read, so the provider skips them', () => {
    expect(responsesEventSchema.safeParse({ type: 'response.created' }).success).toBe(false);
  });

  it('rejects a known event with the wrong shape', () => {
    expect(
      responsesEventSchema.safeParse({ type: 'response.output_text.delta', delta: 1 }).success,
    ).toBe(false);
    expect(
      responsesEventSchema.safeParse({
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'c1', name: 'f' },
      }).success,
    ).toBe(false);
  });

  it('rejects a reasoning item without encrypted content (it could not be resent)', () => {
    expect(
      responsesEventSchema.safeParse({
        type: 'response.output_item.done',
        item: { type: 'reasoning', id: 'rs_1' },
      }).success,
    ).toBe(false);
  });
});
