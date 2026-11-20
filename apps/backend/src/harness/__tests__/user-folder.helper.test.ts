import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUserFolder } from '../user-folder.helper.js';

/** Symbolic links need a privilege on Windows that tests can't count on. */
const itWithSymlinks = process.platform === 'win32' ? it.skip : it;
let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'user-folder-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const folder = async (...parts: string[]) => {
  const made = path.join(base, ...parts);

  await mkdir(made, { recursive: true });

  return made;
};

describe('isUserFolder', () => {
  it('is true when the workspace is the user’s home: its .sheavly is the home', async () => {
    const workspace = await folder('user');
    const home = await folder('user', '.sheavly');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(true);
  });

  it('is true when the workspace is a parent of the home: its .sheavly holds the home', async () => {
    const workspace = await folder('user');
    const home = await folder('user', '.sheavly', 'state');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(true);
  });

  it('is true for a home that is not made yet but would lie inside the workspace’s .sheavly', async () => {
    const workspace = await folder('user', '.sheavly');

    expect(
      await isUserFolder({
        workspaceRoot: path.dirname(workspace),
        home: path.join(workspace, 'new'),
      }),
    ).toBe(true);
  });

  itWithSymlinks('is true when the home is a link to the workspace’s .sheavly', async () => {
    const workspace = await folder('user');

    await folder('user', '.sheavly');
    await symlink(path.join(workspace, '.sheavly'), path.join(base, 'home-link'));

    expect(
      await isUserFolder({ workspaceRoot: workspace, home: path.join(base, 'home-link') }),
    ).toBe(true);
  });

  itWithSymlinks('is true when the workspace’s .sheavly is a link to the home', async () => {
    const workspace = await folder('user');
    const home = await folder('elsewhere', 'sheavly-home');

    await symlink(home, path.join(workspace, '.sheavly'));

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(true);
  });

  itWithSymlinks('is true when the workspace is reached through a link', async () => {
    const workspace = await folder('user');
    const home = await folder('user', '.sheavly');

    await symlink(workspace, path.join(base, 'alias'));

    expect(await isUserFolder({ workspaceRoot: path.join(base, 'alias'), home })).toBe(true);
  });

  it('is false for a sibling whose name only starts like the .sheavly folder', async () => {
    const workspace = await folder('project');
    const home = await folder('project', '.sheavlyfoo');

    await folder('project', '.sheavly');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(false);
  });

  it('is false when the home is elsewhere: an ordinary project’s .sheavly', async () => {
    const workspace = await folder('project');
    const home = await folder('home', '.sheavly');

    await folder('project', '.sheavly');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(false);
  });

  it('is false for a workspace below the home, whose own .sheavly is a project’s', async () => {
    const home = await folder('home', '.sheavly');
    const workspace = await folder('home', '.sheavly', 'workspaces', 'repo');

    await folder('home', '.sheavly', 'workspaces', 'repo', '.sheavly');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(false);
  });

  it('is false when the workspace has no .sheavly', async () => {
    const workspace = await folder('project');
    const home = await folder('home', '.sheavly');

    expect(await isUserFolder({ workspaceRoot: workspace, home })).toBe(false);
  });
});
