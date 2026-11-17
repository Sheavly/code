import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { testProcesses } from '@sheavly/process/testing/process-runner.fake';
import { createDeleteFileTool } from '../../delete-file/delete-file.tool.js';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';

// `FileReads` keeps a hash of what the agent was shown of a file. A command does not clear it:
// `edit_file` and `delete_file` compare the file's current hash and refuse only if it changed.

const NEXT = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
const temp = useTempWorkspace({
  prefix: 'file-reads-stale-',
  perTest: true,
  files: { 'app.ts': 'const a = 1;\nconst b = 2;\n', 'next.ts': NEXT },
});
const fileLocks = useFileLocks();
const fileReads = useFileReads();
const signal = new AbortController().signal;

const call = (name: string, input: Record<string, unknown>) => {
  const services = {
    workspace: temp.workspace,
    fileLocks: fileLocks.current,
    fileReads: fileReads.current,
  };

  return runTool({
    tools: [
      createReadFileTool(services),
      createEditFileTool(services),
      createDeleteFileTool(services),
      createRunCommandTool({
        workspace: temp.workspace,
        processes: testProcesses(),
        permissions: testPermissions({ mode: 'allow_all' }),
      }),
    ],
    call: { id: callIdSchema.parse('1'), name, input: { description: name, ...input } },
    signal,
  });
};

const editB = () =>
  call('edit_file', { path: 'app.ts', oldText: 'const b = 2;', newText: 'const b = 3;' });

describe('what an agent was shown of a file, after a command ran', () => {
  it('a command that rewrites the file makes the next edit fail, and a new read lets it through', async () => {
    await call('read_file', { path: 'app.ts' });
    await call('run_command', { command: 'cp next.ts app.ts' });

    const refused = await editB();

    expect(refused).toMatchObject({ isError: true });
    expect(refused.content).toContain('changed since you read it');
    expect(await readFile(path.join(temp.root, 'app.ts'), 'utf8')).toBe(NEXT);

    await call('read_file', { path: 'app.ts' });

    expect(await editB()).toMatchObject({ isError: false });
    expect(await readFile(path.join(temp.root, 'app.ts'), 'utf8')).toContain('const b = 3;');
  });

  it('a command that does not touch the file leaves the read valid, so the edit needs no new read', async () => {
    await call('read_file', { path: 'app.ts' });

    const ran = await call('run_command', { command: 'echo hi' });
    const edited = await editB();

    expect(ran).toMatchObject({ isError: false });
    expect(edited).toMatchObject({ isError: false });
    expect(await readFile(path.join(temp.root, 'app.ts'), 'utf8')).toBe(
      'const a = 1;\nconst b = 3;\n',
    );
  });

  it('delete_file after a command rewrote the file fails, and leaves the file in place', async () => {
    await call('read_file', { path: 'app.ts' });
    await call('run_command', { command: 'cp next.ts app.ts' });

    const deleted = await call('delete_file', { path: 'app.ts' });

    expect(deleted).toMatchObject({ isError: true });
    expect(deleted.content).toContain('changed since you read it');
    expect(await readFile(path.join(temp.root, 'app.ts'), 'utf8')).toBe(NEXT);
  });
});
