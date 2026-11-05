import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import { isMissingPath } from '@sheavly/runtime/errors/errors.utils';
import { ProfileRegistry } from '../profile-registry/profile-registry.service.js';
import type { OpenProfile } from '../profile-registry/open-profile.service.js';

/** Test-only: ids the registry's tests share. */
export const WORK = profileIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30');
export const HOME = profileIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71');
export const GHOST = profileIdSchema.parse('c1e8a3d4-7b25-4e69-8f10-2a6d9b4c7e53');
export const ASTRA = modelIdSchema.parse('4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a31');
export const BORA = modelIdSchema.parse('9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b72');

/** Test-only: two models of different adapters, as a profile would hold (a fresh copy each call). */
export function twoModels() {
  return {
    astra: {
      id: ASTRA,
      name: 'Astra 6',
      adapter: 'azure-openai',
      definition: { baseUrl: 'https://acme.openai.azure.com/openai/v1', deployment: 'gpt-5' },
    },
    bora: { id: BORA, name: 'Bora', adapter: 'openai', definition: { model: 'gpt-6' } },
  };
}

/** Test-only: two workspace paths (real paths of folders that need not exist). */
export const APP = path.resolve(path.sep, 'code', 'app');
export const SITE = path.resolve(path.sep, 'code', 'site');

/**
 * Test-only: a registry on a fresh temp folder for each test, removed after it. Call it in a
 * `describe`; read `root()` and `registry()` inside the tests, since a new pair is made for each.
 * The profiles folder is made writable again before it is removed, as a test may have locked it.
 */
export function useTempRegistry(): {
  root: () => string;
  registry: () => ProfileRegistry;
  /** A profile `WORK` that exists, opened. */
  openWork: () => Promise<OpenProfile>;
} {
  let root = '';
  let registry: ProfileRegistry | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'storage-registry-'));
    registry = new ProfileRegistry({ root });
  });

  afterEach(async () => {
    await chmod(path.join(root, 'profiles'), 0o700).catch((caughtError: unknown) => {
      if (!isMissingPath(caughtError)) throw caughtError;
    });
    await rm(root, { recursive: true, force: true });
  });

  const current = () => {
    if (!registry) throw new RangeError('useTempRegistry: read it inside a test');

    return registry;
  };

  return {
    root: () => root,
    registry: current,
    openWork: async () => {
      await current().put({ id: WORK, name: 'Work' });

      return current().open(WORK);
    },
  };
}
