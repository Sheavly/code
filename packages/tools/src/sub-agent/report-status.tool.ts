import { z } from 'zod';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import type { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
import { ToolCallError } from '@sheavly/core/errors/tool.errors';
import { reportStatusPrompts } from './report-status.prompt.js';

/**
 * Given to every sub-agent: it reports its own live status ("editing core package"). This is
 * the sub-agent saying what it does, not the harness watching it. The status goes to the session
 * registry, which streams it to the UI (SSE) and into the parent's task output.
 */
export function createReportStatusTool({ sessions }: { sessions: SessionRegistry }) {
  return defineTool({
    name: 'report_status',
    description: reportStatusPrompts.description,
    inputSchema: z.object({
      status: z.string().min(1).max(120).describe(reportStatusPrompts.status),
    }),
    execute: async ({ input: { status }, context }) => {
      if (!context.session) {
        throw new ToolCallError({
          reason: 'unavailable',
          message: 'report_status only works inside an agent session',
        });
      }

      sessions.report({ id: context.session.id, status });

      return 'Status reported.';
    },
  });
}
