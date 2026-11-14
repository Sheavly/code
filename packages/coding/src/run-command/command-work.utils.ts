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
