import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { restoringMarks } from '../marks-stdout.helper.js';
import { carryMark, shellMarkSequence } from '../marks.utils.js';

function open() {
  const stream = Object.assign(new PassThrough(), { columns: 80 });
  let written = '';

  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => (written += chunk));

  return { stream, written: () => written };
}

describe('restoringMarks', () => {
  it('writes the sequences for the marks it is given', () => {
    const { stream, written } = open();

    restoringMarks(stream).write(`${carryMark('prompt')}› hi\n`);

    expect(written()).toBe(`${shellMarkSequence('prompt')}› hi\n`);
  });

  it('passes the callback of a write on, which a renderer waits on to flush', async () => {
    const { stream } = open();
    const flushed = new Promise<void>((resolve) =>
      restoringMarks(stream).write('x', () => resolve()),
    );

    await expect(flushed).resolves.toBeUndefined();
  });

  it('answers what the stream does: its size, its events, its state', () => {
    const { stream } = open();
    const wrapped = restoringMarks(stream);
    let resized = 0;

    wrapped.on('resize', () => (resized += 1));
    stream.emit('resize');

    expect(wrapped.columns).toBe(80);
    expect(resized).toBe(1);
    expect(wrapped.writable).toBe(true);
  });
});
