import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentIdFor } from '../../testing/file-reads.fake.js';
import { Workspace } from '../workspace.service.js';
import { WorkspaceError } from '../../errors/workspace.errors.js';

let base: string;
let scratch: string;
let workspace: Workspace;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'workspace-scratch-test-'));
  await mkdir(path.join(base, 'workspace'));
  await mkdir(path.join(base, 'outside'));
  await writeFile(path.join(base, 'outside', 'secret.txt'), 'secret\n');
  workspace = await Workspace.open(path.join(base, 'workspace'), {
    scratchRoot: path.join(base, 'scratch'),
  });
  scratch = workspace.scratchRoot!;
  await symlink(path.join(base, 'outside'), path.join(scratch, 'link-out'));
  await symlink(path.join(base, 'outside', 'nope'), path.join(scratch, 'broken'));
  await symlink(scratch, path.join(base, 'workspace', 'link-to-scratch'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('Workspace scratch root', () => {
  it('creates the root with mode 0700', async () => {
    expect((await stat(scratch)).mode & 0o777).toBe(0o700);
  });

  it('allows reading and writing under the scratch root, including other agents folders', async () => {
    const dir = await workspace.scratchDir(agentIdFor('agent-a'));
    const file = path.join(dir, 'note.md');

    await writeFile(file, 'hi');
    expect(await workspace.resolveRead(file)).toBe(file);
    expect(await workspace.resolveWrite(path.join(scratch, 'agent-b', 'new.md'))).toBe(
      path.join(scratch, 'agent-b', 'new.md'),
    );
  });

  it('shows scratch files by absolute path', async () => {
    expect(workspace.relative(path.join(scratch, 'x'))).toBe(path.join(scratch, 'x'));
    expect(workspace.relative(path.join(workspace.root, 'src', 'a.ts'))).toBe('src/a.ts');
  });

  it('rejects other paths in the temp directory and ../ escapes', async () => {
    await expect(workspace.resolveRead(path.join(base, 'outside', 'secret.txt'))).rejects.toThrow(
      /outside the workspace/,
    );
    await expect(workspace.resolveWrite(path.join(scratch, '..', 'x'))).rejects.toThrow(
      WorkspaceError,
    );
    await expect(workspace.resolveWrite(`${scratch}/../x`)).rejects.toThrow(WorkspaceError);
  });

  it('rejects a symlink from scratch to outside, and a broken one', async () => {
    await expect(
      workspace.resolveRead(path.join(scratch, 'link-out', 'secret.txt')),
    ).rejects.toThrow(WorkspaceError);
    await expect(workspace.resolveWrite(path.join(scratch, 'broken'))).rejects.toThrow(
      WorkspaceError,
    );
  });

  it('allows a symlink from the workspace into scratch', async () => {
    const file = path.join(scratch, 'via-link.txt');

    await writeFile(file, 'x');
    expect(await workspace.resolveRead('link-to-scratch/via-link.txt')).toBe(file);
  });

  it('only accepts a single path segment as agent id', async () => {
    for (const id of ['', '.', '..', 'a/b', '../x']) {
      await expect(workspace.scratchDir(agentIdFor(id))).rejects.toThrow(WorkspaceError);
    }
  });

  it('rejects a sibling folder that only shares the scratch root name as a prefix', async () => {
    await expect(workspace.resolveRead(`${scratch}-evil/x`)).rejects.toThrow(WorkspaceError);
    await expect(workspace.resolveWrite(`${scratch}-evil/x`)).rejects.toThrow(WorkspaceError);
  });

  it('rejects a ../ escape when reading', async () => {
    await expect(
      workspace.resolveRead(path.join(scratch, '..', 'outside', 'secret.txt')),
    ).rejects.toThrow(WorkspaceError);
  });

  it('refuses an agent folder that is a symlink', async () => {
    await symlink(path.join(base, 'outside'), path.join(scratch, 'linked-agent'));
    await expect(workspace.scratchDir(agentIdFor('linked-agent'))).rejects.toThrow(
      /symlinks are refused/,
    );
  });

  it('refuses an agent folder that others can write to', async () => {
    const open = path.join(scratch, 'open-agent');

    await mkdir(open);
    await chmod(open, 0o777);
    await expect(workspace.scratchDir(agentIdFor('open-agent'))).rejects.toThrow(
      /writable by other users/,
    );
  });

  it('refuses a scratch root that is a symlink', async () => {
    await symlink(path.join(base, 'outside'), path.join(base, 'root-link'));
    await expect(
      Workspace.open(path.join(base, 'workspace'), { scratchRoot: path.join(base, 'root-link') }),
    ).rejects.toThrow(/symlinks are refused/);
  });

  it('refuses a scratch root that others can write to', async () => {
    const open = path.join(base, 'open-root');

    await mkdir(open);
    await chmod(open, 0o777);
    await expect(
      Workspace.open(path.join(base, 'workspace'), { scratchRoot: open }),
    ).rejects.toThrow(/writable by other users/);
  });

  it('refuses a scratch root and an agent folder that another user owns', async () => {
    const uid = process.getuid?.() ?? 0;
    const other = vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);

    try {
      await expect(workspace.scratchDir(agentIdFor('agent-a'))).rejects.toThrow(
        /belongs to another user/,
      );
      await expect(
        Workspace.open(path.join(base, 'workspace'), { scratchRoot: scratch }),
      ).rejects.toThrow(/belongs to another user/);
    } finally {
      other.mockRestore();
    }
  });

  it('has no scratch dir without a scratch root', async () => {
    const plain = await Workspace.open(path.join(base, 'workspace'));

    await expect(plain.scratchDir(agentIdFor('a'))).rejects.toThrow(WorkspaceError);
  });
});
