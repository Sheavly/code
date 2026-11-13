import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useFileLocks } from '@sheavly/workspace/testing/file-locks.fake';
import { useFileReads } from '@sheavly/workspace/testing/file-reads.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { createEditFileTool } from '../../edit-file/edit-file.tool.js';
import { createReadFileTool } from '../../read-file/read-file.tool.js';
import { testPermissions } from '../../testing/permissions.fake.js';
import { createRunCommandTool } from '../run-command.tool.js';

// Reproduction: `FileReads` records what the agent was shown of a file, and a command that
// rewrites the file does not invalidate it, so `edit_file` works from a read the command made
// stale. The fixing change flips `it.fails` to `it`.

const temp = useTempWorkspace({
  prefix: 'file-reads-stale-',
  perTest: true,
  files: {
    'app.ts': 'const a = 1;\nconst b = 2;\n',
    'next.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
  },
});
const fileLocks = useFileLocks();
const fileReads = useFileReads();
const signal = new AbortController().signal;

const call = (name: string, input: Record<string, unknown>) =>
  runTool({
    tools: [
      createReadFileTool({ workspace: temp.workspace, fileReads: fileReads.current }),
      createEditFileTool({
        workspace: temp.workspace,
        fileLocks: fileLocks.current,
        fileReads: fileReads.current,
      }),
      createRunCommandTool({
        workspace: temp.workspace,
        processes: testProcesses(),
        permissions: testPermissions({ mode: 'allow_all' }),
      }),
    ],
    call: { id: callIdSchema.parse('1'), name, input: { description: name, ...input } },
    signal,
  });

/** Reads the file, has a command rewrite it, then edits it from that read. */
async function editAfterCommandRewrote() {
  await call('read_file', { path: 'app.ts' });
  await call('run_command', { command: 'cp next.ts app.ts' });

  return call('edit_file', { path: 'app.ts', oldText: 'const b = 2;', newText: 'const b = 3;' });
}

describe('what an agent was shown of a file, after a command changed it', () => {
  it('pinned today: the command really rewrote the file and the edit goes through', async () => {
    const edited = await editAfterCommandRewrote();

    expect(edited).toMatchObject({ isError: false });
    expect(await readFile(path.join(temp.root, 'app.ts'), 'utf8')).toBe(
      'const a = 1;\nconst b = 3;\nconst c = 3;\n',
    );
  });

  it.fails('edit_file asks for a new read once run_command rewrote the file', async () => {
    expect(await editAfterCommandRewrote()).toMatchObject({ isError: true });
  });
});
