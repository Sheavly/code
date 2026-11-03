import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';

/**
 * Test-only tool that never finishes on its own: it waits until its call is aborted (a stopped
 * prompt, an interrupt), then fails. For tests that stop a run mid-tool-call.
 */
export const blockTool = defineTool({
  name: 'block',
  description: 'Blocks until aborted',
  inputSchema: z.object({}),
  execute: ({ signal }) =>
    new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
});
