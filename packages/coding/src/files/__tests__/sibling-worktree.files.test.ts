import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { FileReads } from '@sheavly/workspace/file-reads/file-reads.service';
import { openWithWorktrees, useTempRepo } from '@sheavly/workspace/testing/git-repo.fake';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import type { Workspace } from '@sheavly/workspace/workspace/workspace.service';
import { resolveCommandCwd } from '../../run-command/command-cwd.helper.js';
import { resolveWritable } from '../files.helper.js';

/** The name-based guards (.env, .git) still hold for paths in a sibling worktree. */
const repo = useTempRepo({ prefix: 'sibling-guards-' });
let workspace: Workspace;

beforeAll(async () => {
  workspace = await openWithWorktrees(repo.main);
});

describe('a sibling worktree', () => {
  it('lets a source file be written', async () => {
    const requested = path.join(repo.worktree, 'src/new.ts');

    await expect(resolveWritable({ workspace, requested, root: undefined })).resolves.toBe(
      requested,
    );
  });

  it('refuses writing a .env file', async () => {
    await expect(
      resolveWritable({ workspace, requested: path.join(repo.worktree, '.env'), root: undefined }),
    ).rejects.toThrow(/\.env/);
  });

  it('refuses writing inside .git', async () => {
    await expect(
      resolveWritable({
        workspace,
        requested: path.join(repo.worktree, '.git/config'),
        root: undefined,
      }),
    ).rejects.toThrow(/\.git/);
  });

  it('refuses .git as a command cwd', async () => {
    await expect(
      resolveCommandCwd({
        workspace,
        requested: path.join(repo.worktree, '.git'),
        root: undefined,
      }),
    ).rejects.toThrow(/Running a command inside \.git/);
  });
});

describe('read_file in a sibling worktree', () => {
  const read = (requested: string) =>
    runTool({
      tools: [createReadFileTool({ workspace, fileReads: new FileReads() })],
      call: {
        id: callIdSchema.parse('1'),
        name: 'read_file',
        input: { description: 'reading', path: requested },
      },
      signal: new AbortController().signal,
    });

  it('reads a source file', async () => {
    await expect(read(path.join(repo.worktree, 'src/index.ts'))).resolves.toMatchObject({
      isError: false,
    });
  });

  it('refuses the sibling worktree .git file', async () => {
    const result = await read(path.join(repo.worktree, '.git'));

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Reading inside .git');
  });

  it('refuses the main worktree .git config from a workspace rooted at a linked worktree', async () => {
    const linked = await openWithWorktrees(repo.worktree);
    const result = await runTool({
      tools: [createReadFileTool({ workspace: linked, fileReads: new FileReads() })],
      call: {
        id: callIdSchema.parse('1'),
        name: 'read_file',
        input: { description: 'reading', path: path.join(repo.main, '.git/config') },
      },
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.content).toContain('Reading inside .git');
  });
});
