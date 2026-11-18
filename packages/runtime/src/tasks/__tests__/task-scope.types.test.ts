import { describe, expectTypeOf, it } from 'vitest';
import type { SessionId } from '@sheavly/protocol/session/session.types';
import type { TaskId } from '@sheavly/protocol/task/task.types';
import type { BackgroundTaskScope, TaskControl, TaskStarter } from '../task-scope.types.js';
import type { TaskRegistry } from '../tasks.service.js';

describe('the task scope contracts', () => {
  it('lets the registry and a scope start work through one TaskStarter', () => {
    expectTypeOf<TaskRegistry>().toExtend<TaskStarter>();
    expectTypeOf<BackgroundTaskScope>().toExtend<TaskStarter>();
  });

  it('never reads an absent session as every task: TaskControl always takes a sessionId', () => {
    expectTypeOf<Parameters<TaskControl['list']>[0]>().toEqualTypeOf<SessionId>();
    expectTypeOf<Parameters<TaskControl['report']>[1]>().toEqualTypeOf<SessionId>();
    expectTypeOf<Parameters<TaskControl['getOwned']>[0]['sessionId']>().toEqualTypeOf<SessionId>();
    expectTypeOf<Parameters<TaskControl['cancel']>[0]['sessionId']>().toEqualTypeOf<SessionId>();
    expectTypeOf<Parameters<TaskControl['group']>[0]['sessionId']>().toEqualTypeOf<SessionId>();
  });

  it('keeps the registry-wide verbs out of both scopes', () => {
    expectTypeOf<BackgroundTaskScope>().not.toHaveProperty('cancelAll');
    expectTypeOf<BackgroundTaskScope>().not.toHaveProperty('cancelSession');
    expectTypeOf<TaskControl>().not.toHaveProperty('start');
    expectTypeOf<Parameters<BackgroundTaskScope['get']>[0]>().toEqualTypeOf<TaskId>();
  });
});
