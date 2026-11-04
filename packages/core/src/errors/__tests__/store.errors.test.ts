import { describe, expect, it } from 'vitest';
import { StoreError } from '../store.errors.js';

describe('StoreError', () => {
  it('says why, and keeps the storage error behind it', () => {
    const disk = new Error('ENOSPC');
    const error = new StoreError({ reason: 'failed', message: 'Could not write', cause: disk });

    expect(error).toMatchObject({ name: 'StoreError', reason: 'failed', cause: disk });
    expect(error.message).toBe('Could not write');
  });

  it('needs no cause for a refusal of its own', () => {
    const error = new StoreError({ reason: 'out_of_order', message: 'Expected seq 3' });

    expect(error.reason).toBe('out_of_order');
    expect(error.cause).toBeUndefined();
  });
});
