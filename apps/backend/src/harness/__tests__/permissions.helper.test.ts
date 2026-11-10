import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionStore } from '@sheavly/storage/permission-store/permission-store.service';
import { workspacePermissions } from '../permissions.helper.js';

let base: string;
let home: string;
let root: string;
let store: PermissionStore;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'workspace-permissions-'));
  home = path.join(base, 'sheavly');
  root = path.join(base, 'project');
  await mkdir(root, { recursive: true });
  root = realpathSync(root);
  store = new PermissionStore({ root: home });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('workspacePermissions', () => {
  it('reads the folder’s permissions fresh each time, so a change shows at the next command', async () => {
    const permissions = workspacePermissions({ store, workspace: root, env: process.env });

    expect(await permissions.read()).toEqual({ mode: 'ask', allow: [] });

    await store.setMode({ realPath: root, mode: 'allow_all' });
    await store.allow({ realPath: root, entry: 'git log *' });

    expect(await permissions.read()).toEqual({ mode: 'allow_all', allow: ['git log *'] });
  });

  it('keeps an allowed command in the user’s folder, for this folder only', async () => {
    const permissions = workspacePermissions({ store, workspace: root, env: process.env });
    const other = workspacePermissions({
      store,
      workspace: path.join(base, 'elsewhere'),
      env: process.env,
    });

    await permissions.allow('echo hi *');

    expect(await permissions.read()).toMatchObject({ allow: ['echo hi *'] });
    expect(await other.read()).toMatchObject({ allow: [] });
    expect(existsSync(path.join(home, 'permissions'))).toBe(true);
    expect(existsSync(path.join(root, '.sheavly'))).toBe(false); // never in the repo
  });

  it('is shared by every permissions made for the same folder', async () => {
    const first = workspacePermissions({ store, workspace: root, env: process.env });
    const second = workspacePermissions({ store, workspace: root, env: process.env });

    await first.allow('ls src');

    expect(await second.read()).toMatchObject({ allow: ['ls src'] });
  });

  it('keeps session grants in one conversation, never the workspace store or another conversation', async () => {
    const first = workspacePermissions({ store, workspace: root, env: process.env });
    const second = workspacePermissions({ store, workspace: root, env: process.env });

    await first.allowSession?.('npx vitest run *');

    expect(await first.read()).toMatchObject({ allow: ['npx vitest run *'] });
    expect(await second.read()).toMatchObject({ allow: [] });
    expect(await store.read(root)).toEqual({ mode: 'ask', allow: [] });
    expect(existsSync(path.join(home, 'permissions'))).toBe(false);
  });

  it('reads policy changes fresh even after a temporary grant was made', async () => {
    const permissions = workspacePermissions({ store, workspace: root, env: process.env });

    await permissions.allowSession?.('npm run test *');
    await store.setMode({ realPath: root, mode: 'always_ask' });

    expect(await permissions.read()).toMatchObject({ mode: 'always_ask' });
  });
});
