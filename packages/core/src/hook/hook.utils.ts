import type { Hook, HookHandlerName } from './hook.types.js';

/** Every handler a hook can define, so a check can't miss a newly added one. */
const HANDLERS = {
  sessionStart: true,
  beforeTurn: true,
  aroundToolCall: true,
  afterTurn: true,
  onError: true,
} satisfies Record<HookHandlerName, true>;

/** True if the hook defines at least one handler. */
export function hasHandler(hook: Hook): boolean {
  return Object.keys(HANDLERS).some((name) => hook[name as HookHandlerName] !== undefined);
}
