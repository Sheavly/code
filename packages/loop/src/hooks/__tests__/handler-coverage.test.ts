import { describe, expect, it } from 'vitest';
import { handlerNames } from '@sheavly/core/hook/hook.utils';
import type { HookHandlerName } from '@sheavly/core/hook/hook.types';
import * as hooks from '../hooks.helper.js';
import * as points from '../new-points.helper.js';

/**
 * The loop's runner for each hook point. Typed against `HookHandlerName`, so adding a point to
 * `HANDLER_NAMES` fails the typecheck here until its runner is named; the test then proves the
 * runner exists. (`Hook`, `handlerNames` and the project-hook schema derive from the same list.)
 */
const RUNNERS = {
  sessionStart: 'runSessionStart',
  beforeTurn: 'runBeforeTurn',
  beforeModelCall: 'runBeforeModelCall',
  beforeSummary: 'runBeforeSummary',
  afterSummary: 'runAfterSummary',
  aroundToolCall: 'runToolCall',
  afterTurn: 'runAfterTurn',
  taskCompleted: 'runTaskCompleted',
  notice: 'runNotice',
  approval: 'approvalScreener',
  sessionEnd: 'runSessionEnd',
  onError: 'runOnError',
} satisfies Record<HookHandlerName, string>;

describe('every hook point has a loop runner', () => {
  const exported: Record<string, unknown> = { ...hooks, ...points };

  it.each(handlerNames())('%s', (name) => {
    expect(typeof exported[RUNNERS[name]]).toBe('function');
  });

  it('names no runner for a point that is not in the list', () => {
    expect(Object.keys(RUNNERS).sort()).toEqual([...handlerNames()].sort());
  });
});
