/**
 * The one list of hook points. `Hook` (its handlers), `handlerNames`, the project-hook schema
 * and the loop's pipeline all derive from it, so a new point is one entry here (plus its
 * signature in `hook.types.ts`) and a consumer that doesn't handle it fails its typecheck or its
 * coverage test. The order is the order handlers are listed in messages.
 */
export const HANDLER_NAMES = [
  'sessionStart',
  'beforeTurn',
  'beforeModelCall',
  'beforeSummary',
  'afterSummary',
  'aroundToolCall',
  'afterTurn',
  'taskCompleted',
  'notice',
  'approval',
  'sessionEnd',
  'onError',
] as const;
