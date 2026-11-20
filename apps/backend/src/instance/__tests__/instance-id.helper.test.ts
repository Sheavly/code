import { describe, expect, it } from 'vitest';
import { instanceIdSchema } from '@sheavly/protocol/handshake/handshake.validator';
import { newInstanceId } from '../instance-id.helper.js';

describe('newInstanceId', () => {
  it('is 43 characters of unpadded base64url and a valid instance id', () => {
    const id = newInstanceId();

    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(instanceIdSchema.safeParse(id).success).toBe(true);
  });

  it('differs on every call', () => {
    expect(new Set(Array.from({ length: 200 }, () => newInstanceId())).size).toBe(200);
  });
});
