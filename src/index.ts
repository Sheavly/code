// The package's one public entry point (`main`). Inside src/, import from the defining file.
export { runAgent, streamAgent } from './loop/stream-agent/stream-agent.service.js';
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
export {
  createCancelTaskTool,
  createTaskStatusTool,
  createTaskTools,
} from './tools/tasks/tasks.tool.js';
export { TaskRegistry } from './runtime/tasks/tasks.service.js';
export { formatTask } from './runtime/tasks/tasks.utils.js';
export type { StartTask, TaskInfo, TaskStatus } from './runtime/tasks/tasks.types.js';
export { Workspace } from './runtime/workspace/workspace.service.js';
export { WorkspaceError } from './runtime/workspace/workspace.errors.js';
export { loadProjectHooks } from './runtime/project-hooks/project-hooks.service.js';
export { ProjectHooksError } from './runtime/project-hooks/project-hooks.errors.js';
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
export { astraAdapter } from './providers/adapters/astra.adapter.js';
export { ProviderSwitch } from './providers/switch/switch.service.js';
