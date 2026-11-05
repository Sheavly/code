import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorkspace, unsafeWorkspaceReason } from '../workspace-path.helper.js';

const HOME = path.resolve(path.sep, 'home', 'ada');
const SHEAVLY = path.join(HOME, '.sheavly');
const reason = (real: string) => unsafeWorkspaceReason({ real, home: HOME, sheavlyHome: SHEAVLY });

describe('unsafeWorkspaceReason', () => {
  it('accepts an ordinary project, also one named like the home or folder it sits near', () => {
    for (const real of [
      path.join(HOME, 'projects', 'app'),
      path.join(HOME, '.sheavly-notes'),
      path.join(HOME, '.sheavly2', 'app'),
      path.resolve(path.sep, 'srv', 'app'),
    ]) {
      expect(reason(real), real).toBeUndefined();
    }
  });

  it('refuses the top of a file system and the home folder', () => {
    expect(reason(path.resolve(path.sep))).toContain('root of a file system');
    expect(reason(HOME)).toContain('home folder');
  });

  it('refuses the folder that holds the user’s keys, a parent of it, and anything inside it', () => {
    expect(reason(SHEAVLY)).toBeDefined();
    expect(reason(path.join(SHEAVLY, 'profiles'))).toContain('inside the folder');
    expect(reason(path.join(SHEAVLY, 'profiles', 'x', 'credentials'))).toContain('inside');
    // A folder that contains the keys' folder is just as much a way to it.
    expect(reason(path.resolve(path.sep, 'home'))).toContain('holds the folder');
  });
});

describe('resolveWorkspace', () => {
  let base = '';
  let sheavlyHome = '';

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'workspace-path-'));
    sheavlyHome = path.join(base, 'sheavly');
    await mkdir(path.join(base, 'project'), { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const resolve = (requested: string) => resolveWorkspace({ requested, sheavlyHome });
  const refusal = (requested: string) =>
    resolve(requested).then(
      () => undefined,
      (caughtError: unknown) => caughtError,
    );

  it('returns the real path of a folder, following a symlink to it', async () => {
    await symlink(path.join(base, 'project'), path.join(base, 'link'));

    const real = await resolve(path.join(base, 'link'));

    expect(path.basename(real)).toBe('project');
  });

  it('refuses what is not an absolute path to an existing folder, saying which', async () => {
    await writeFile(path.join(base, 'file.txt'), 'x');

    for (const [requested, says] of [
      ['project', 'absolute'],
      ['../project', 'absolute'],
      ['', 'absolute'],
      [path.join(base, 'missing'), 'no such folder'],
      [path.join(base, 'file.txt'), 'not a folder'],
    ] as const) {
      expect(await refusal(requested), requested).toMatchObject({
        name: 'SetupError',
        reason: 'invalid',
        message: expect.stringContaining(says) as string,
      });
    }
  });

  it('refuses a symlink that leads into the keys’ folder, judged by where it really goes', async () => {
    await mkdir(path.join(sheavlyHome, 'profiles'), { recursive: true });
    await symlink(path.join(sheavlyHome, 'profiles'), path.join(base, 'innocent'));

    expect(await refusal(path.join(base, 'innocent'))).toMatchObject({ reason: 'invalid' });
    expect(await refusal(sheavlyHome)).toMatchObject({ reason: 'invalid' });
  });

  it('allows a project when the keys’ folder does not exist yet, as on a first run', async () => {
    await expect(resolve(path.join(base, 'project'))).resolves.toBeDefined();
  });
});
