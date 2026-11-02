import type { Hook } from './hook.types.js';
import { DefinitionError } from '../errors/definition.errors.js';
import { hasHandler } from './hook.utils.js';

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
