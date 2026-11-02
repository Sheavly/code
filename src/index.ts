// The package's one public entry point (`main`). Inside src/, import from the defining file.
export { runAgent, runSession, streamAgent } from './loop/stream-agent/stream-agent.helper.js';
export type { AgentOptions, RunAgentOptions } from './loop/stream-agent/stream-agent.types.js';
export type * from '@sheavly/protocol/event/event.types';
export { OrderedQueue } from './loop/queue/queue.service.js';
export type { Sequenced } from './loop/queue/queue.types.js';
export { defineTool } from '@sheavly/core/tool/tool.utils';
export { describeCall } from '@sheavly/core/tool/tool.validator';
export type {
  Tool,
  ToolContext,
  ToolExecution,
  ToolOutput,
  ToolRunResult,
} from '@sheavly/core/tool/tool.types';
export { defineHook } from '@sheavly/core/hook/hook.utils';
export type * from '@sheavly/core/hook/hook.types';
export { createReadFileTool } from './tools/read-file/read-file.tool.js';
export type { FileRead } from './tools/read-file/read-file.types.js';
export { isFileRead } from './tools/read-file/read-file.utils.js';
export { createWriteFileTool } from './tools/write-file/write-file.tool.js';
export { createEditFileTool } from './tools/edit-file/edit-file.tool.js';
export { FileLocks } from './runtime/file-locks/file-locks.service.js';
export type { FileChange } from './tools/files/files.types.js';
export { isFileChange } from './tools/files/files.utils.js';
export { createRunCommandTool } from './tools/run-command/run-command.tool.js';
export type { RunCommandOptions } from './tools/run-command/run-command.types.js';
export { ProcessRunner } from './runtime/process/process.service.js';
export { DEFAULT_ALLOW_LIST } from './tools/run-command/allow-list.constants.js';
export { ApprovalRegistry } from '@sheavly/runtime/approvals/approvals.service';
export type * from '@sheavly/protocol/approval/approval.types';
export {
  createCancelTaskTool,
  createTaskStatusTool,
  createTaskTools,
} from './tools/tasks/tasks.tool.js';
export { TaskRegistry } from '@sheavly/runtime/tasks/tasks.service';
export { formatTask } from '@sheavly/runtime/tasks/tasks.utils';
export type { StartTask } from '@sheavly/runtime/tasks/tasks.types';
export type * from '@sheavly/protocol/task/task.types';
export { Workspace } from './runtime/workspace/workspace.service.js';
export { WorkspaceError } from './runtime/errors/workspace.errors.js';
export { loadProjectHooks } from './runtime/project-hooks/project-hooks.helper.js';
export { createAgentsMdHook, findAgentsFiles } from './runtime/agents-md/agents-md.helper.js';
export type { AgentsFile, AgentsMdHookOptions } from './runtime/agents-md/agents-md.types.js';
export { ProjectHooksError } from './runtime/errors/project-hooks.errors.js';
export type { HooksManifest } from './runtime/project-hooks/project-hooks.types.js';
export type * from '@sheavly/protocol/message/message.types';
export type * from '@sheavly/core/message/message.types';
export type * from '@sheavly/core/provider/provider.types';
export { AdapterRegistry } from '@sheavly/providers/registry/registry.service';
export { defineAdapter } from '@sheavly/core/adapter/adapter.utils';
export type { Adapter, AdapterDeps } from '@sheavly/core/adapter/adapter.types';
export { createDefaultRegistry } from '@sheavly/providers/registry/default-registry.helper';
export { DEFAULT_ADAPTER, DEFAULT_MODEL } from './host/host.constants.js';
export { openaiAdapter } from '@sheavly/providers/openai/openai.adapter';
export { azureAdapter } from '@sheavly/providers/azure/azure.adapter';
export { ProviderSwitch } from '@sheavly/providers/switch/switch.service';
export { SessionRegistry } from '@sheavly/runtime/sessions/sessions.service';
export { MAX_SESSION_DEPTH } from '@sheavly/runtime/sessions/sessions.constants';
export type { RunSession } from '@sheavly/runtime/sessions/sessions.types';
export type * from '@sheavly/protocol/session/session.types';
export { createSubAgentTool } from './tools/sub-agent/sub-agent.tool.js';
export { createReportStatusTool } from './tools/sub-agent/report-status.tool.js';
export { createMessageAgentTool } from './tools/sub-agent/message-agent.tool.js';
export type { RunNestedAgent, SubAgentOptions } from './tools/sub-agent/sub-agent.types.js';
