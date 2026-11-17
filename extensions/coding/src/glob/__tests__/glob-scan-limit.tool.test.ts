import path from 'node:path';
import { utimes } from 'node:fs/promises';
import { describe, expect, it, beforeAll } from 'vitest';
import { runTool } from '@sheavly/core/tool/tool.helper';
import { callIdSchema } from '@sheavly/protocol/message/message.validator';
import { testProcesses } from '@sheavly/workspace/testing/process-runner.fake';
import { useTempWorkspace } from '@sheavly/workspace/testing/temp-workspace.fake';
import { MAX_GLOB_SCANNED } from '../glob.constants.js';
import { createGlobTool } from '../glob.tool.js';
import { isGlobResult } from '../glob-format.utils.js';

const name = (index: number) => `big/f${String(index).padStart(5, '0')}.dat`;
const temp = useTempWorkspace({
  prefix: 'glob-scan-test-',
  files: Object.fromEntries(Array.from({ length: MAX_GLOB_SCANNED + 1 }, (_, i) => [name(i), ''])),
});

describe('glob past the scan limit', () => {
  // The last file by path is the newest of all but falls past the limit, so it is never looked at;
  // the first file is the newest of those scanned, which proves the scan ran and was sorted.
  beforeAll(async () => {
    await utimes(path.join(temp.root, name(MAX_GLOB_SCANNED)), 4_000_000_000, 4_000_000_000);
    await utimes(path.join(temp.root, name(0)), 3_000_000_000, 3_000_000_000);
  });

  it('sorts only the files it scanned', async () => {
    const result = await runTool({
      tools: [createGlobTool({ workspace: temp.workspace, processes: testProcesses() })],
      call: {
        id: callIdSchema.parse('1'),
        name: 'glob',
        input: { description: 'finding files', pattern: '*.dat' },
      },
      signal: new AbortController().signal,
    });
    const artifact = result.artifacts?.find(isGlobResult);

    expect(artifact?.files[0]).toBe(name(0));
    expect(artifact?.files).not.toContain(name(MAX_GLOB_SCANNED));
  });
});
