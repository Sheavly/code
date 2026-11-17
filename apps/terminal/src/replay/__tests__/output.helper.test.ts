import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeUntilReaderLeaves } from '../output.helper.js';

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('writeUntilReaderLeaves', () => {
  it('writes to the output while the reader is there', async () => {
    const output = new PassThrough();
    const { write, failure: failed } = writeUntilReaderLeaves(output);

    write('a');
    write('b');

    expect(String(output.read())).toBe('ab');
    expect(await failed()).toBeUndefined();
  });

  it('stops writing, without failing, once the reader of the pipe has gone', async () => {
    const output = new PassThrough();
    const { write, failure: failed } = writeUntilReaderLeaves(output);

    output.emit('error', failure('EPIPE'));
    write('after');

    expect(output.read()).toBeNull();
    expect(await failed()).toBeUndefined();
  });

  it('keeps any other error of the output for the caller, and stops writing', async () => {
    const output = new PassThrough();
    const { write, failure: failed } = writeUntilReaderLeaves(output);

    expect(() => output.emit('error', failure('ENOSPC'))).not.toThrow();
    output.emit('error', failure('EIO'));
    write('after');

    expect((await failed())?.message).toBe('Could not write the replay: ENOSPC');
    expect(output.read()).toBeNull();
  });

  it('reports a write that fails only after it was made, as writing to a full disk does', async () => {
    const full = new Writable({ write: (_chunk, _encoding, done) => done(failure('ENOSPC')) });
    const { write, failure: failed } = writeUntilReaderLeaves(full);

    write('lost');

    expect((await failed())?.message).toBe('Could not write the replay: ENOSPC');
  });
});
