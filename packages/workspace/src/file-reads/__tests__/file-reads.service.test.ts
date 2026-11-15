import { describe, expect, it } from 'vitest';
import { MAX_CHUNKS_PER_FILE } from '../file-reads.constants.js';
import { FileReads } from '../file-reads.service.js';

const MAIN = { agent: 'main', file: '/w/a.ts' };
const read = (
  reads: FileReads,
  text: string,
  whole = false,
  who: { agent: string; file: string; hash?: string } = MAIN,
) => reads.markRead({ hash: 'v1', ...who, text, whole });

describe('FileReads', () => {
  it('has seen nothing at first, and what an agent was shown', () => {
    const reads = new FileReads();

    expect(reads.hasRead(MAIN)).toBe(false);
    expect(reads.hasSeen({ ...MAIN, text: 'one' })).toBe(false);

    read(reads, 'line one\nline two\n');

    expect(reads.hasRead(MAIN)).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'line two' })).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'line three' })).toBe(false);
  });

  it('knows only the lines it was shown: reading the top says nothing of the bottom', () => {
    const reads = new FileReads();

    read(reads, 'top 1\ntop 2\n');

    expect(reads.hasSeen({ ...MAIN, text: 'top 2' })).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'bottom 500' })).toBe(false);
    expect(reads.hasReadWhole(MAIN)).toBe(false);
  });

  it('adds up several reads of one file, each a piece of its own', () => {
    const reads = new FileReads();

    read(reads, 'first\n');
    read(reads, 'second\n');

    expect(reads.hasSeen({ ...MAIN, text: 'first' })).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'second' })).toBe(true);
    // Text that spans two reads was never shown together: it does not count.
    expect(reads.hasSeen({ ...MAIN, text: 'first\nsecond' })).toBe(false);
  });

  it('knows a whole-file read, which covers the file and replaces the pieces before it', () => {
    const reads = new FileReads();

    read(reads, 'part\n');
    read(reads, 'part\nrest\n', true);

    expect(reads.hasReadWhole(MAIN)).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'part\nrest' })).toBe(true);
  });

  it('keeps each agent’s reads to itself: a child must read what its parent read', () => {
    const reads = new FileReads();
    const child = { agent: 'child', file: '/w/a.ts' };

    read(reads, 'secret line\n', true);

    expect(reads.hasRead(child)).toBe(false);
    expect(reads.hasSeen({ ...child, text: 'secret line' })).toBe(false);
    expect(reads.hasReadWhole(child)).toBe(false);
  });

  it('keeps each file apart, and one instance from another', () => {
    const reads = new FileReads();

    read(reads, 'in a\n');

    expect(reads.hasSeen({ agent: 'main', file: '/w/b.ts', text: 'in a' })).toBe(false);
    expect(new FileReads().hasRead(MAIN)).toBe(false);
  });

  it('follows the agent’s own edit: the new text can be edited again without a read', () => {
    const reads = new FileReads();

    read(reads, 'const a = 1;\nconst b = 2;\n');
    reads.markEdited({
      ...MAIN,
      oldText: 'const b = 2;',
      newText: 'const b = 3;',
      replaceAll: false,
      hash: 'v2',
    });

    expect(reads.hasSeen({ ...MAIN, text: 'const b = 3;' })).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'const b = 2;' })).toBe(false);
    expect(reads.hasSeen({ ...MAIN, text: 'const a = 1;' })).toBe(true);
  });

  it('follows a replaceAll in every piece, and ignores an edit to a file it never saw', () => {
    const reads = new FileReads();

    read(reads, 'x = 1;\n');
    read(reads, 'x = 1;\nx = 1;\n');
    reads.markEdited({
      ...MAIN,
      oldText: 'x = 1;',
      newText: 'x = 2;',
      replaceAll: true,
      hash: 'v2',
    });

    expect(reads.hasSeen({ ...MAIN, text: 'x = 2;\nx = 2;' })).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: 'x = 1;' })).toBe(false);

    reads.markEdited({
      agent: 'main',
      file: '/w/never.ts',
      oldText: 'a',
      newText: 'b',
      replaceAll: false,
      hash: 'v2',
    });
    expect(reads.hasRead({ agent: 'main', file: '/w/never.ts' })).toBe(false);
  });

  it('forgets a file it was told was deleted, for every agent, and keeps the others', () => {
    const reads = new FileReads();
    const child = { agent: 'child', file: '/w/a.ts' };
    const other = { agent: 'main', file: '/w/b.ts' };

    read(reads, 'gone\n', true);
    read(reads, 'gone\n', true, child);
    read(reads, 'kept\n', true, other);

    reads.markDeleted({ file: '/w/a.ts' });

    expect(reads.hasRead(MAIN)).toBe(false);
    expect(reads.hasReadWhole(MAIN)).toBe(false);
    expect(reads.hasRead(child)).toBe(false);
    expect(reads.hasRead(other)).toBe(true);
    expect(reads.hasSeen({ ...other, text: 'kept' })).toBe(true);
  });

  it('forgets the oldest pieces past a limit, but never a whole-file read', () => {
    const reads = new FileReads();

    read(reads, 'WHOLE FILE\n', true);

    for (let index = 0; index < MAX_CHUNKS_PER_FILE + 5; index += 1) {
      read(reads, `piece ${String(index)}\n`);
    }

    expect(reads.hasSeen({ ...MAIN, text: 'WHOLE FILE' })).toBe(true);
    expect(reads.hasReadWhole(MAIN)).toBe(true);
    expect(reads.hasSeen({ ...MAIN, text: `piece ${String(MAX_CHUNKS_PER_FILE + 4)}` })).toBe(true);
  });

  it('keeps a read while the file still has the hash it was read with', () => {
    const reads = new FileReads();

    read(reads, 'one\n', true);

    expect(reads.forgetIfChanged({ ...MAIN, hash: 'v1' })).toBe(false);
    expect(reads.hasReadWhole(MAIN)).toBe(true);
  });

  it('forgets a read once the file has another hash, for that agent only', () => {
    const reads = new FileReads();
    const other = { agent: 'other', file: '/w/a.ts' };

    read(reads, 'one\n', true);
    read(reads, 'one\n', true, other);

    expect(reads.forgetIfChanged({ ...MAIN, hash: 'v9' })).toBe(true);
    expect(reads.hasRead(MAIN)).toBe(false);
    expect(reads.hasRead(other)).toBe(true);
  });

  it('has nothing to forget for an agent that never read the file', () => {
    const reads = new FileReads();

    expect(reads.forgetIfChanged({ ...MAIN, hash: 'v1' })).toBe(false);
  });

  it('lets another agent’s edit stale this agent’s view, but not the editor’s own', () => {
    const reads = new FileReads();
    const child = { agent: 'child', file: '/w/a.ts' };

    read(reads, 'a\nb\n', true);
    read(reads, 'a\nb\n', true, child);
    reads.markEdited({ ...MAIN, oldText: 'b', newText: 'c', replaceAll: false, hash: 'v2' });

    expect(reads.forgetIfChanged({ ...MAIN, hash: 'v2' })).toBe(false);
    expect(reads.forgetIfChanged({ ...child, hash: 'v2' })).toBe(true);
  });

  it('starts a new view when a piece is read from a changed file, never mixing versions', () => {
    const reads = new FileReads();

    read(reads, 'old top\n');
    read(reads, 'new bottom\n', false, { ...MAIN, hash: 'v2' });

    expect(reads.hasSeen({ ...MAIN, text: 'old top' })).toBe(false);
    expect(reads.hasSeen({ ...MAIN, text: 'new bottom' })).toBe(true);
  });

  it('forgets one agent when its session ends, and keeps the others', () => {
    const reads = new FileReads();
    const other = { agent: 'other', file: '/w/a.ts' };

    read(reads, 'one\n', true);
    read(reads, 'one\n', true, other);

    reads.forgetAgent({ agent: 'main' });

    expect(reads.hasRead(MAIN)).toBe(false);
    expect(reads.hasRead(other)).toBe(true);
  });

  it('forgets the oldest piece of a file never read whole', () => {
    const reads = new FileReads();

    for (let index = 0; index < MAX_CHUNKS_PER_FILE + 1; index += 1) {
      read(reads, `piece ${String(index)}\n`);
    }

    expect(reads.hasSeen({ ...MAIN, text: 'piece 0\n' })).toBe(false);
    expect(reads.hasSeen({ ...MAIN, text: 'piece 1\n' })).toBe(true);
  });
});
