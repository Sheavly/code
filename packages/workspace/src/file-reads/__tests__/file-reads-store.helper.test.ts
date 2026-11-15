import { describe, expect, it } from 'vitest';
import { memoryShellStore } from '../../working-root/memory-shell.helper.js';
import { FileReads } from '../file-reads.service.js';
import { keepFileReads, restoreFileReads } from '../file-reads-store.helper.js';

const FILE = '/w/a.ts';
const view = { agent: 'main', file: FILE, text: 'const a = 1;\n', whole: true, hash: 'h1' };

describe('keeping and restoring an agent’s reads in shell.json', () => {
  it('gives a reopened conversation what the agent had read', async () => {
    const store = memoryShellStore();
    const before = new FileReads();

    before.markRead(view);
    await keepFileReads({ fileReads: before, agent: 'main', store });

    const after = new FileReads();

    await restoreFileReads({ fileReads: after, agent: 'main-again', store });

    // A reopened session may have another id: what is kept is the agent's views, not its id.
    expect(after.hasReadWhole({ agent: 'main-again', file: FILE })).toBe(true);
    expect(after.forgetIfChanged({ agent: 'main-again', file: FILE, hash: 'h1' })).toBe(false);
    expect(after.forgetIfChanged({ agent: 'main-again', file: FILE, hash: 'h2' })).toBe(true);
  });

  it('keeps the working root and anything else already in the document', async () => {
    const store = memoryShellStore({ workingRoot: '/w/tree', other: 1 });
    const reads = new FileReads();

    reads.markRead(view);
    await keepFileReads({ fileReads: reads, agent: 'main', store });

    expect(await store.load()).toMatchObject({ workingRoot: '/w/tree', other: 1 });
  });

  it('restores nothing from a document with no reads', async () => {
    const reads = new FileReads();

    await restoreFileReads({ fileReads: reads, agent: 'main', store: memoryShellStore() });
    await restoreFileReads({
      fileReads: reads,
      agent: 'main',
      store: memoryShellStore({ workingRoot: '/w/tree' }),
    });

    expect(reads.hasRead({ agent: 'main', file: FILE })).toBe(false);
  });

  it.each([
    ['not an object', 'nope'],
    ['a view without a hash', { [FILE]: { chunks: ['x'], whole: true } }],
    ['an empty hash', { [FILE]: { chunks: ['x'], whole: true, hash: '' } }],
    ['chunks that are not text', { [FILE]: { chunks: [1], whole: true, hash: 'h' } }],
  ])('refuses stored reads that are %s, and restores none of them', async (_name, stored) => {
    const reads = new FileReads();
    const store = memoryShellStore({ fileReads: stored });

    await expect(restoreFileReads({ fileReads: reads, agent: 'main', store })).rejects.toThrow(
      'stored file reads are not valid',
    );
    expect(reads.hasRead({ agent: 'main', file: FILE })).toBe(false);
  });
});
