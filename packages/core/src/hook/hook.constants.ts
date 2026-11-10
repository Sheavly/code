import type { HookHandlerName } from './hook.types.js';

/** Every handler a hook can define, so a check can't miss a newly added one. */
export const HANDLERS = {
  sessionStart: true,
  beforeTurn: true,
  beforeModelCall: true,
  aroundToolCall: true,
  afterTurn: true,
  onError: true,
} satisfies Record<HookHandlerName, true>;
