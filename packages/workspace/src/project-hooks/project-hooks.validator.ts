import path from 'node:path';
import { z } from 'zod';
import { handlerNames, hasHandler } from '@sheavly/core/hook/hook.utils';
import type { Hook, HookHandlerName } from '@sheavly/core/hook/hook.types';
import { validate } from '@sheavly/core/validation/validation.validator';
import { HOOK_EXTENSIONS, MAX_HOOK_AFTER, MAX_HOOK_NAME_CHARS } from './project-hooks.constants.js';

/** `.sheavly/hooks.json`. Unknown keys are rejected, so a typo doesn't silently do nothing. */
export const hooksManifestSchema = z.strictObject({
  version: z.literal(1),
  hooks: z.array(
    z.strictObject({
      /** Relative to `.sheavly/`, e.g. `hooks/audit.js`. */
      path: z
        .string()
        .min(1)
        .refine((file) => HOOK_EXTENSIONS.includes(path.extname(file)), {
          message: `A hook file must end in one of: ${HOOK_EXTENSIONS.join(', ')}`,
        }),
      enabled: z.boolean().default(true),
    }),
  ),
});

/** The handler names for an error message: `a, b or c`, read from `HANDLERS` so none is missed. */
function handlerList(): string {
  const names = handlerNames();

  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/** A handler is any function; what it receives and returns is typed by `Hook`. */
const handler = z.custom<() => unknown>((value) => typeof value === 'function').optional();

/** One optional function per handler name, read from the one list so none can be forgotten. */
const handlerShape = Object.fromEntries(handlerNames().map((name) => [name, handler])) as Record<
  HookHandlerName,
  typeof handler
>;

/** What a hook file must export (as default): the same shape `defineHook` accepts. */
const hookExportSchema = z
  .strictObject({
    name: z.string().min(1).max(MAX_HOOK_NAME_CHARS),
    /** Hooks this one must run after, by name; bounded so a hook file cannot make ordering costly. */
    after: z.array(z.string().min(1).max(MAX_HOOK_NAME_CHARS)).max(MAX_HOOK_AFTER).optional(),
    ...handlerShape,
  })
  .refine((hook) => hasHandler(hook as Hook), {
    message: `Define at least one handler: ${handlerList()}`,
  });

/** Validates a hook file's default export; returns an error message instead of throwing. */
export function parseHookExport(exported: unknown): { hook: Hook } | { error: string } {
  const parsed = validate({ schema: hookExportSchema, input: exported });

  if (!parsed.success) return { error: parsed.details };

  // The schema checked every handler is a function; `Hook` gives their signatures.
  return { hook: parsed.data as Hook };
}
