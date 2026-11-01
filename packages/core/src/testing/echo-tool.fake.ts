import { z } from 'zod';
import { defineTool } from '../tool/tool.service.js';

/** Test-only tool that replies with the input it ran with, as JSON (after the harness's own fields are stripped). */
export const echoTool = defineTool({
  name: 'echo',
  description: 'Echoes text back',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ input }) => JSON.stringify(input),
});
