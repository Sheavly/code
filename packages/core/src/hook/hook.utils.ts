import type { Hook, HookHandlerName } from './hook.types.js';
import { DefinitionError } from '../errors/definition.errors.js';
import { HANDLERS } from './hook.constants.js';

/** True if the hook defines at least one handler. */
export function hasHandler(hook: Hook): boolean {
  return Object.keys(HANDLERS).some((name) => hook[name as HookHandlerName] !== undefined);
}

/** Identity helper for writing a hook; rejects one that handles nothing. */
export function defineHook(hook: Hook): Hook {
  if (!hasHandler(hook)) {
    throw new DefinitionError({
      definition: 'hook',
      defined: hook.name,
      problem: 'define at least one handler',
    });
  }

  return hook;
}
