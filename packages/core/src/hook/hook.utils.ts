import type { Hook, HookHandlerName } from './hook.types.js';
import { DefinitionError } from '../errors/definition.errors.js';
import { HANDLER_NAMES } from './hook.constants.js';

/** Every handler name a hook can define, in the order of `HANDLER_NAMES`. */
export function handlerNames(): readonly HookHandlerName[] {
  return HANDLER_NAMES;
}

/** True if the hook defines at least one handler. */
export function hasHandler(hook: Hook): boolean {
  return handlerNames().some((name) => hook[name] !== undefined);
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
