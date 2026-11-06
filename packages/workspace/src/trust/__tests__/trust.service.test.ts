import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustStoreError } from '../../errors/trust.errors.js';
import { memoryTrust } from '../../testing/trust.fake.js';
import type { MemoryTrust } from '../../testing/testing.types.js';
import { TRUST_STORE_VERSION } from '../trust.constants.js';
import { useFixedClock } from '@sheavly/testing/clock/fixed-clock.fake';
import { fingerprintWorkspace, TrustStore } from '../trust.service.js';
import { fingerprintOf } from '../trust.utils.js';

const clock = useFixedClock();

let base = '';
let root = '';
let persistence: MemoryTrust;
let store: TrustStore;

/** Writes `files` under the project's `.sheavly/`. */
async function sheavly(files: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, '.sheavly', file)), { recursive: true });
    await writeFile(path.join(root, '.sheavly', file), content);
  }
}

/** A trust store over `file`, a place it pretends to live in: it is never written to disk. */
const storeAt = (file: string) => new TrustStore({ persistence: memoryTrust({ file }) });

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'trust-test-'));
  root = path.join(base, 'project');
  persistence = memoryTrust({ file: path.join(base, 'config', 'trusted-workspaces.json') });
  store = new TrustStore({ persistence });
  await mkdir(root);
  await sheavly({
    'hooks.json': '{"version":1,"hooks":[{"path":"hooks/a.js"}]}',
    'hooks/a.js': 'a',
  });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('TrustStore', () => {
  it('treats a workspace it has never seen as untrusted, with nothing stored yet', async () => {
    expect(await store.check({ root })).toBe('untrusted');
  });

  it('remembers a trusted workspace in what it was given, in the current format', async () => {
    await store.trust({ root });

    expect(await store.check({ root })).toBe('trusted');
    expect(await new TrustStore({ persistence }).check({ root })).toBe('trusted');
    expect(persistence.get()).toMatchObject({ version: TRUST_STORE_VERSION });
  });

  it.each([
    ['an edited hook file', { 'hooks/a.js': 'a, but evil' }],
    ['a new file', { 'hooks/b.js': 'b' }],
    ['an edited manifest', { 'hooks.json': '{"version":1,"hooks":[]}' }],
  ])('marks a trusted workspace changed after %s', async (_change, files) => {
    await store.trust({ root });
    await sheavly(files);

    expect(await store.check({ root })).toBe('changed');

    await store.trust({ root });
    expect(await store.check({ root })).toBe('trusted');
  });

  it('marks a trusted workspace changed when a file is removed or a symlink retargeted', async () => {
    await symlink('a.js', path.join(root, '.sheavly', 'hooks', 'link.js'));
    await store.trust({ root });
    await rm(path.join(root, '.sheavly', 'hooks', 'link.js'));
    await symlink('../../elsewhere.js', path.join(root, '.sheavly', 'hooks', 'link.js'));

    expect(await store.check({ root })).toBe('changed');
  });

  it('keys a workspace by its real path, so a symlink to it shares its trust', async () => {
    const alias = path.join(base, 'alias');

    await symlink(root, alias);
    await store.trust({ root: alias });

    expect(await store.check({ root })).toBe('trusted');
  });

  it('trusts each workspace on its own, and forgets one on revoke', async () => {
    const other = path.join(base, 'other');

    await mkdir(other);
    await store.trust({ root });
    await store.trust({ root: other });

    await store.revoke({ root });

    expect(await store.check({ root })).toBe('untrusted');
    expect(await store.check({ root: other })).toBe('trusted');
  });

  it('leaves the store alone when it revokes a workspace that was never trusted', async () => {
    await store.revoke({ root });

    expect(persistence.get()).toBeUndefined();
  });

  describe('listing what is trusted', () => {
    const other = () => path.join(base, 'other');

    it('lists nothing when nothing is trusted, without writing', async () => {
      expect(await store.list()).toEqual([]);
      expect(persistence.get()).toBeUndefined();
    });

    it('lists each trusted workspace by its real path, oldest first, trusted while unchanged', async () => {
      await mkdir(other());
      await store.trust({ root: other() });
      clock.advance(1_000);
      await store.trust({ root });

      const listed = await store.list();

      expect(listed.map((each) => each.root)).toEqual([
        await realpath(other()),
        await realpath(root),
      ]);
      expect(listed.map((each) => each.state)).toEqual(['trusted', 'trusted']);
      expect((listed[1]?.trustedAt ?? 0) - (listed[0]?.trustedAt ?? 0)).toBe(1_000);
    });

    it('lists those trusted at the same moment in path order, so the order never varies', async () => {
      await mkdir(other());
      await store.trust({ root });
      await store.trust({ root: other() });

      expect((await store.list()).map((each) => each.root)).toEqual([
        await realpath(other()),
        await realpath(root),
      ]);
    });

    it('says changed for one whose .sheavly/ changed since, and trusted for the rest', async () => {
      await mkdir(other());
      await store.trust({ root });
      await store.trust({ root: other() });
      await sheavly({ 'hooks/a.js': 'a, but evil' });

      // `other` sorts before `project`; only `project` changed.
      expect((await store.list()).map((each) => each.state)).toEqual(['trusted', 'changed']);
    });

    it('says gone for a folder that no longer exists, and revoking it clears it', async () => {
      await mkdir(other());
      await store.trust({ root: other() });

      const trustedAs = (await store.list())[0]?.root ?? '';

      await rm(other(), { recursive: true });

      expect((await store.list()).map((each) => each.state)).toEqual(['gone']);

      await store.revoke({ root: trustedAs });

      expect(await store.list()).toEqual([]);
    });

    it('revokes by the path it was trusted under, so a gone folder given as it was is cleared too', async () => {
      await mkdir(other());
      await store.trust({ root: other() });
      await rm(other(), { recursive: true });
      await store.revoke({ root: other() });

      expect(await store.list()).toEqual([]);
    });

    it('reports a damaged store as a TrustStoreError, not as nothing trusted', async () => {
      persistence.set({ version: 999, workspaces: {} });

      await expect(store.list()).rejects.toBeInstanceOf(TrustStoreError);
    });
  });

  it('keeps what was trusted when another workspace is trusted after it', async () => {
    const other = path.join(base, 'other');

    await mkdir(other);
    await store.trust({ root });
    await store.trust({ root: other });

    expect(await store.check({ root })).toBe('trusted');
    expect(await store.check({ root: other })).toBe('trusted');
  });

  it.each([
    [
      'the wrong shape',
      { version: TRUST_STORE_VERSION, workspaces: { '/x': { fingerprint: '' } } },
    ],
    ['another version', { version: TRUST_STORE_VERSION + 1, workspaces: {} }],
    [
      'the previous format, with ISO times',
      {
        version: 1,
        workspaces: { '/x': { fingerprint: 'sha256:a', trustedAt: '2026-11-03T11:39:39.880Z' } },
      },
    ],
    ['not an object at all', 'trusted'],
  ])(
    'refuses a store that is %s, naming the file, instead of trusting nothing',
    async (_, stored) => {
      persistence.set(stored);

      await expect(store.check({ root })).rejects.toBeInstanceOf(TrustStoreError);
      await expect(store.check({ root })).rejects.toThrow(persistence.file);
      await expect(store.trust({ root })).rejects.toBeInstanceOf(TrustStoreError);
      // A store that cannot be read is never replaced with a new one.
      expect(persistence.get()).toEqual(stored);
    },
  );

  it('tells a user with a previous-format store to delete it and trust again', async () => {
    persistence.set({ version: 1, workspaces: {} });

    await expect(store.check({ root })).rejects.toThrow('Delete it and trust each workspace again');
  });

  it('reports a store it cannot read or write as a TrustStoreError naming the file', async () => {
    const disk = new Error('EACCES: permission denied');

    persistence.failWith(disk);

    for (const call of [
      () => store.check({ root }),
      () => store.trust({ root }),
      () => store.revoke({ root }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TrustStoreError);
      await expect(call()).rejects.toMatchObject({ cause: disk, file: persistence.file });
    }
  });

  it('refuses a store inside the workspace, which the repo could ship to trust itself', async () => {
    const inside = storeAt(path.join(root, 'config', 'trusted.json'));

    await expect(inside.trust({ root })).rejects.toThrow('inside the workspace');
    await expect(inside.check({ root })).rejects.toBeInstanceOf(TrustStoreError);
  });

  it('refuses a store in a folder of the workspace whose name starts with dots', async () => {
    await expect(
      storeAt(path.join(root, '..config', 'trusted.json')).trust({ root }),
    ).rejects.toThrow('inside the workspace');
  });

  it('accepts a store beside the workspace, which is not inside it', async () => {
    await expect(storeAt(path.join(base, 'trusted.json')).trust({ root })).resolves.toBeUndefined();
  });
});

describe('fingerprintWorkspace', () => {
  it('hashes a project with no .sheavly/ as empty', async () => {
    await rm(path.join(root, '.sheavly'), { recursive: true });

    expect(await fingerprintWorkspace({ root })).toBe(fingerprintOf([]));
  });

  it('does not depend on the order files are found in', () => {
    const a = { path: 'a', content: '1' };
    const b = { path: 'b', content: '2' };

    expect(fingerprintOf([a, b])).toBe(fingerprintOf([b, a]));
    // Lengths are part of the hash: moving bytes from a path to its content changes it.
    expect(fingerprintOf([{ path: 'ab', content: 'c' }])).not.toBe(
      fingerprintOf([{ path: 'a', content: 'bc' }]),
    );
  });
});
