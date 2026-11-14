import type { WorkDefinition, WorkInput } from '@sheavly/runtime/tasks/work.types';
import { finiteWork, serviceWork } from '@sheavly/runtime/tasks/work.utils';

/** A background command that finishes: a build, a test run, a CI wait. */
export function commandTaskWork(input: WorkInput): WorkDefinition {
  return finiteWork(input);
}

/** A background command that runs on: a server or a watcher. */
export function commandServiceWork(input: WorkInput): WorkDefinition {
  return serviceWork(input);
}

/** The command kind the model chose with `backgroundKind`; the policy comes from the kind. */
export function commandWork(params: {
  kind: WorkDefinition['backgroundKind'];
  input: WorkInput;
}): WorkDefinition {
  const { kind, input } = params;

  // Exhaustive, so a third kind of background work fails the typecheck here instead of becoming a task.
  switch (kind) {
    case 'task':
      return commandTaskWork(input);
    case 'service':
      return commandServiceWork(input);
  }
}
