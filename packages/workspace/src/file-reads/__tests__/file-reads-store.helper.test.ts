import { describe, expect, it } from 'vitest';
import { agentIdFor } from '../../testing/file-reads.fake.js';
import { memoryShellStore } from '../../working-root/memory-shell.helper.js';
import { MAX_PERSISTED_FILES } from '../file-reads.constants.js';
import { FileReads } from '../file-reads.service.js';
import { hashText } from '../file-reads.utils.js';
import { createFileReadsKeeper, restoreFileReads } from '../file-reads-store.helper.js';

const FILE = '/w/a.ts';
const TEXT = 'const a = 1;\n';
// A whole-file view restores only when its text hashes to its hash, so the fixture is honest.
const view = {
  agentId: agentIdFor('main'),
  file: FILE,
  text: TEXT,
  whole: true,
  hash: hashText(TEXT),
};

/** Keeps `fileReads`' main agent in `store`, as a prompt ending does. */
const keepOnce = (fileReads: FileReads, store: ReturnType<typeof memoryShellStore>) =>
  createFileReadsKeeper({ fileReads, agentId: agentIdFor('main'), store }).keep();

describe('keeping and restoring an agent’s reads in shell.json', () => {
  it('gives a reopened conversation what the agent had read', async () => {
    const store = memoryShellStore();
    const before = new FileReads();

    before.markRead(view);
    await keepOnce(before, store);

    const after = new FileReads();

    await restoreFileReads({ fileReads: after, agentId: agentIdFor('main-again'), store });

    // A reopened session may have another id: what is kept is the agent's views, not its id.
    expect(after.hasReadWhole({ agentId: agentIdFor('main-again'), file: FILE })).toBe(true);
    expect(
      after.forgetIfChanged({
        agentId: agentIdFor('main-again'),
        file: FILE,
        hash: hashText(TEXT),
      }),
    ).toBe(false);
    expect(
      after.forgetIfChanged({ agentId: agentIdFor('main-again'), file: FILE, hash: 'h2' }),
    ).toBe(true);
  });

  it('keeps the working root and anything else already in the document', async () => {
    const store = memoryShellStore({ workingRoot: '/w/tree', other: 1 });
    const reads = new FileReads();

    reads.markRead(view);
    await keepOnce(reads, store);

    expect(await store.load()).toMatchObject({ workingRoot: '/w/tree', other: 1 });
  });

  it('writes only when the reads changed, and not what it just restored', async () => {
    let writes = 0;
    const inner = memoryShellStore();
    const store = {
      load: () => inner.load(),
      update: (change: Parameters<typeof inner.update>[0]) => {
        writes += 1;

        return inner.update(change);
      },
    };
    const reads = new FileReads();
    const keeper = createFileReadsKeeper({ fileReads: reads, agentId: agentIdFor('main'), store });

    await keeper.keep();
    expect(writes).toBe(0);

    reads.markRead(view);
    await keeper.keep();
    await keeper.keep();
    expect(writes).toBe(1);

    reads.markRead({ ...view, text: 'const a = 2;\n', hash: 'h2' });
    await keeper.keep();
    expect(writes).toBe(2);

    const restored = new FileReads();
    const again = createFileReadsKeeper({
      fileReads: restored,
      agentId: agentIdFor('main'),
      store,
    });

    await restoreFileReads({ fileReads: restored, agentId: agentIdFor('main'), store });
    again.remember();
    await again.keep();
    expect(writes).toBe(2);
  });

  it('writes one save after another, and a failed save does not stop the next', async () => {
    const order: string[] = [];
    let fail = true;
    const inner = memoryShellStore();
    const store = {
      load: () => inner.load(),
      update: async (change: Parameters<typeof inner.update>[0]) => {
        order.push('start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('end');
        if (fail) throw new Error('disk full');

        return inner.update(change);
      },
    };
    const reads = new FileReads();
    const keeper = createFileReadsKeeper({ fileReads: reads, agentId: agentIdFor('main'), store });

    reads.markRead(view);

    const first = keeper.keep();
    const second = keeper.keep();

    fail = true;
    await expect(first).rejects.toThrow('disk full');
    fail = false;
    await expect(second).resolves.toBeUndefined();
    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });

  it('keeps the files touched last when there are more than it keeps', async () => {
    const store = memoryShellStore();
    const reads = new FileReads();

    // The oldest file is read again last: it must outlive the ones read once after it.
    for (let index = 0; index < MAX_PERSISTED_FILES; index += 1) {
      reads.markRead({ ...view, file: `/w/f${String(index)}.ts` });
    }

    reads.markRead({ ...view, file: '/w/f0.ts', text: 'again\n' });
    reads.markRead({ ...view, file: '/w/extra.ts' });
    await keepOnce(reads, store);

    const document = (await store.load()) as { fileReads: Record<string, unknown> };
    const kept = Object.keys(document.fileReads);

    expect(kept).toHaveLength(MAX_PERSISTED_FILES);
    // f0 was read first but again later, so it stays; f1 was read once, long ago, so it goes.
    expect(kept).toContain('/w/f0.ts');
    expect(kept).toContain('/w/extra.ts');
    expect(kept).not.toContain('/w/f1.ts');
  });

  it('restores nothing from a document with no reads', async () => {
    const reads = new FileReads();

    await restoreFileReads({
      fileReads: reads,
      agentId: agentIdFor('main'),
      store: memoryShellStore(),
    });
    await restoreFileReads({
      fileReads: reads,
      agentId: agentIdFor('main'),
      store: memoryShellStore({ workingRoot: '/w/tree' }),
    });

    expect(reads.hasRead({ agentId: agentIdFor('main'), file: FILE })).toBe(false);
  });

  it.each([
    ['not an object', 'nope'],
    ['a view without a hash', { [FILE]: { chunks: ['x'], whole: true } }],
    ['an empty hash', { [FILE]: { chunks: ['x'], whole: true, hash: '' } }],
    ['chunks that are not text', { [FILE]: { chunks: [1], whole: true, hash: 'h' } }],
    ['a whole-file read with no text', { [FILE]: { chunks: [], whole: true, hash: 'h' } }],
    ['a relative path', { 'a.ts': { chunks: ['x'], whole: true, hash: 'h' } }],
    ['too many pieces', { [FILE]: { chunks: Array(65).fill('x'), whole: false, hash: 'h' } }],
    [
      'a hash too long to be one',
      { [FILE]: { chunks: ['x'], whole: true, hash: 'h'.repeat(200) } },
    ],
    [
      'more text than is ever kept',
      { [FILE]: { chunks: ['x'.repeat(2_100_000)], whole: true, hash: 'h' } },
    ],
  ])('refuses stored reads that are %s, and restores none of them', async (_name, stored) => {
    const reads = new FileReads();
    const store = memoryShellStore({ fileReads: stored });

    await expect(
      restoreFileReads({ fileReads: reads, agentId: agentIdFor('main'), store }),
    ).rejects.toThrow('stored file reads are not valid');
    expect(reads.hasRead({ agentId: agentIdFor('main'), file: FILE })).toBe(false);
  });
});
