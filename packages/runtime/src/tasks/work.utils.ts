import type { TaskInfo, TaskKind } from '@sheavly/protocol/task/task.types';
import type { TaskStarter } from './task-scope.types.js';
import type { WorkDefinition, WorkInput } from './work.types.js';

/** Finite work: it keeps its run alive until delivered and can be grouped and awaited. */
export function finiteWork(input: WorkInput): WorkDefinition {
  return { ...input, backgroundKind: 'task' };
}

/**
 * A sub-agent: finite work in every policy (held open for, grouped, awaited), named apart so a UI
 * can tell it from a command.
 */
export function agentWork(input: WorkInput): WorkDefinition {
  return { ...input, backgroundKind: 'agent' };
}

/** A service: never held open for, never awaited, may outlive the run. */
export function serviceWork(input: WorkInput): WorkDefinition {
  return { ...input, backgroundKind: 'service' };
}

/**
 * Whether a kind is finite work: held open for, grouped, awaited and waking an idle session. Every
 * kind but `service` is, so a new kind joins the finite machine unless it says otherwise here.
 */
export function isFiniteKind(kind: TaskKind): boolean {
  return kind !== 'service';
}

/**
 * Starts work a kind's factory built, so a kind's policy is decided by its factory and not at the
 * call site. It is the one place that calls `TaskRegistry.start`: `harness/no-direct-task-start`
 * fails every other source file, so a new kind is a factory that builds a `WorkDefinition`.
 * `tasks` is anything that starts work: the registry, or an extension's task scope.
 */
export function startWork(params: { tasks: TaskStarter; work: WorkDefinition }): TaskInfo {
  const { tasks, work } = params;

  return tasks.start(work);
}
