import type { Hook } from './hook.types.js';
import { hasHandler } from './hook.utils.js';

/** Identity helper for writing a hook; rejects one that handles nothing. */
export function defineHook(hook: Hook): Hook {
  if (!hasHandler(hook)) {
    throw new Error(`Hook ${hook.name}: define at least one handler`);
  }

  return hook;
}
