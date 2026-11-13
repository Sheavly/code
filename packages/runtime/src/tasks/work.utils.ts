import type { TaskInfo } from '@sheavly/protocol/task/task.types';
import type { TaskRegistry } from './tasks.service.js';
import type { WorkDefinition, WorkInput } from './work.types.js';

/** Finite work: it keeps its run alive until delivered and can be grouped and awaited. */
export function finiteWork(input: WorkInput): WorkDefinition {
  return { ...input, backgroundKind: 'task' };
}

/** A service: never held open for, never awaited, may outlive the run. */
export function serviceWork(input: WorkInput): WorkDefinition {
  return { ...input, backgroundKind: 'service' };
}

/**
 * Starts work a kind's factory built, so a kind's policy is decided by its factory and not at the
 * call site. `TaskRegistry.start` stays public and nothing forbids calling it directly yet.
 */
export function startWork(params: { tasks: TaskRegistry; work: WorkDefinition }): TaskInfo {
  const { tasks, work } = params;

  return tasks.start(work);
}
