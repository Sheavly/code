import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustStoreError } from '../../errors/trust.errors.js';
import { fingerprintWorkspace, TrustStore } from '../trust.service.js';
import { fingerprintOf } from '../trust.utils.js';

let base = '';
let root = '';
let storeFile = '';
let store: TrustStore;

/** Writes `files` under the project's `.sheavly/`. */
async function sheavly(files: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, '.sheavly', file)), { recursive: true });
    await writeFile(path.join(root, '.sheavly', file), content);
  }
}

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'trust-test-'));
  root = path.join(base, 'project');
  storeFile = path.join(base, 'config', 'trusted-workspaces.json');
  store = new TrustStore({ file: storeFile });
  await mkdir(root);
  await sheavly({
    'hooks.json': '{"version":1,"hooks":[{"path":"hooks/a.js"}]}',
    'hooks/a.js': 'a',
  });
});

afterEach(async () => {
  await chmod(path.dirname(storeFile), 0o700).catch((caughtError: unknown) => {
    if ((caughtError as { code?: string }).code !== 'ENOENT') throw caughtError;
  });
  await rm(base, { recursive: true, force: true });
});

describe('TrustStore', () => {
  it('treats a workspace it has never seen as untrusted, with no store file yet', async () => {
    expect(await store.check({ root })).toBe('untrusted');
  });

  it('remembers a trusted workspace, in a store outside the repo', async () => {
    await store.trust({ root });

    expect(await store.check({ root })).toBe('trusted');
    expect(await new TrustStore({ file: storeFile }).check({ root })).toBe('trusted');
    expect(JSON.parse(await readFile(storeFile, 'utf8'))).toMatchObject({ version: 1 });
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

    expect(await store.check({ root: other })).toBe('untrusted');

    await store.revoke({ root });
    expect(await store.check({ root })).toBe('untrusted');
  });

  it.each([
    ['not JSON', '{ nope'],
    ['the wrong shape', '{"version":1,"workspaces":{"/x":{"fingerprint":""}}}'],
    ['another version', '{"version":2,"workspaces":{}}'],
  ])(
    'refuses a store that is %s, naming the file, instead of trusting nothing',
    async (_, text) => {
      await mkdir(path.dirname(storeFile), { recursive: true });
      await writeFile(storeFile, text);

      const failure = await store.check({ root }).catch((caughtError: unknown) => caughtError);

      expect(failure).toBeInstanceOf(TrustStoreError);
      expect((failure as Error).message).toContain(storeFile);
    },
  );

  it('refuses a store inside the workspace, which the repo could ship to trust itself', async () => {
    const inside = new TrustStore({ file: path.join(root, 'config', 'trusted.json') });

    await expect(inside.trust({ root })).rejects.toThrow('inside the workspace');
    await expect(inside.check({ root })).rejects.toBeInstanceOf(TrustStoreError);
  });

  it.skipIf(process.getuid?.() === 0)('reports a store it cannot write', async () => {
    await mkdir(path.dirname(storeFile), { recursive: true });
    await chmod(path.dirname(storeFile), 0o500);

    await expect(store.trust({ root })).rejects.toBeInstanceOf(TrustStoreError);
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
