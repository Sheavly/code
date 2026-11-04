import { describe, expect, it } from 'vitest';
import { StoreError } from '../../errors/store.errors.js';
import { toStoreError } from '../store.utils.js';

describe('toStoreError', () => {
  it('keeps an error a store already raised', () => {
    const raised = new StoreError({ reason: 'out_of_order', message: 'Expected seq 3' });

    expect(toStoreError({ error: raised, message: 'Could not write' })).toBe(raised);
  });

  it('wraps any other error, keeping it as the cause', () => {
    const disk = new Error('ENOSPC');
    const wrapped = toStoreError({ error: disk, message: 'Could not write' });

    expect(wrapped).toBeInstanceOf(StoreError);
    expect(wrapped).toMatchObject({ reason: 'failed', message: 'Could not write', cause: disk });
  });

  it('wraps a thrown value that is not an error', () => {
    expect(toStoreError({ error: 'boom', message: 'Could not write' })).toMatchObject({
      reason: 'failed',
      cause: 'boom',
    });
  });
});
