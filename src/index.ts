// The package's one public entry point (`main`). Inside src/, import from the defining file.
export { runAgent, runSession, streamAgent } from './loop/stream-agent/stream-agent.service.js';
export type { AgentOptions, RunAgentOptions } from './loop/stream-agent/stream-agent.types.js';
export type {
  AgentEvent,
  AgentEventBody,
  DescribedCall,
  DoneReason,
} from './loop/events/events.types.js';
export { OrderedQueue } from './loop/queue/queue.service.js';
export type { Sequenced } from './loop/queue/queue.types.js';
export { defineTool, describeCall } from '@sheavly/core/tool/tool.service';
export type {
  FileChange,
  FileRead,
  Tool,
  ToolContext,
  ToolExecution,
  ToolOutput,
  ToolRunResult,
} from '@sheavly/core/tool/tool.types';
export { defineHook } from '@sheavly/core/hook/hook.service';
export type * from '@sheavly/core/hook/hook.types';
export { createReadFileTool } from './tools/read-file/read-file.tool.js';
export { createWriteFileTool } from './tools/write-file/write-file.tool.js';
export { createEditFileTool } from './tools/edit-file/edit-file.tool.js';
export { createRunCommandTool } from './tools/run-command/run-command.tool.js';
export type { RunCommandOptions } from './tools/run-command/run-command.types.js';
export { DEFAULT_ALLOW_LIST } from './tools/run-command/allow-list.constants.js';
export { ApprovalRegistry } from './runtime/approvals/approvals.service.js';
export type {
  ApprovalConcern,
  ApprovalOption,
  ApprovalRequest,
  ApprovalResponse,
  ApprovalUpdate,
} from './runtime/approvals/approvals.types.js';
export {
  createCancelTaskTool,
  createTaskStatusTool,
  createTaskTools,
} from './tools/tasks/tasks.tool.js';
export { TaskRegistry } from './runtime/tasks/tasks.service.js';
export { formatTask } from './runtime/tasks/tasks.utils.js';
export type { StartTask, TaskInfo, TaskStatus } from './runtime/tasks/tasks.types.js';
export { Workspace } from './runtime/workspace/workspace.service.js';
export { WorkspaceError } from './runtime/errors/workspace.errors.js';
export { loadProjectHooks } from './runtime/project-hooks/project-hooks.service.js';
export { createAgentsMdHook, findAgentsFiles } from './runtime/agents-md/agents-md.service.js';
export type { AgentsFile, AgentsMdHookOptions } from './runtime/agents-md/agents-md.types.js';
export { ProjectHooksError } from './runtime/errors/project-hooks.errors.js';
export type { HooksManifest } from './runtime/project-hooks/project-hooks.types.js';
export type * from '@sheavly/core/message/message.types';
export type * from '@sheavly/core/provider/provider.types';
export { AdapterRegistry } from './providers/registry/registry.service.js';
export { defineAdapter } from '@sheavly/core/adapter/adapter.service';
export type { Adapter, AdapterDeps } from '@sheavly/core/adapter/adapter.types';
export { createDefaultRegistry } from './providers/adapters/adapters.service.js';
export { DEFAULT_ADAPTER, DEFAULT_MODEL } from './providers/adapters/adapters.constants.js';
export { openaiAdapter } from './providers/adapters/openai.adapter.js';
export { azureAdapter } from './providers/adapters/azure.adapter.js';
export { ProviderSwitch } from './providers/switch/switch.service.js';
export { SessionRegistry } from './runtime/sessions/sessions.service.js';
export { MAX_SESSION_DEPTH } from './runtime/sessions/sessions.constants.js';
export type { RunSession } from './runtime/sessions/sessions.types.js';
export type * from '@sheavly/core/session/session.types';
export { createSubAgentTool } from './tools/sub-agent/sub-agent.tool.js';
export { createReportStatusTool } from './tools/sub-agent/report-status.tool.js';
export { createMessageAgentTool } from './tools/sub-agent/message-agent.tool.js';
export type { RunNestedAgent, SubAgentOptions } from './tools/sub-agent/sub-agent.types.js';
