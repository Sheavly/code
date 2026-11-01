import path from 'node:path';
import { z } from 'zod';
import { hasHandler } from '@sheavly/core/hook/hook.utils';
import type { Hook } from '@sheavly/core/hook/hook.types';
import { HOOK_EXTENSIONS } from './project-hooks.constants.js';

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

/** A handler is any function; what it receives and returns is typed by `Hook`. */
const handler = z.custom<() => unknown>((value) => typeof value === 'function').optional();

/**
 * What a hook file must export (as default): the same shape `defineHook` accepts. Every key is
 * listed against `Hook`'s handlers (`satisfies`), so a new handler can't be forgotten here.
 */
const hookExportSchema = z
  .strictObject({
    name: z.string().min(1),
    ...({
      sessionStart: handler,
      beforeTurn: handler,
      aroundToolCall: handler,
      afterTurn: handler,
      onError: handler,
    } satisfies Record<keyof Omit<Hook, 'name'>, typeof handler>),
  })
  .refine((hook) => hasHandler(hook as Hook), {
    message:
      'Define at least one handler: sessionStart, beforeTurn, aroundToolCall, afterTurn or onError',
  });

/** Validates a hook file's default export; returns an error message instead of throwing. */
export function parseHookExport(exported: unknown): { hook: Hook } | { error: string } {
  const parsed = hookExportSchema.safeParse(exported);

  if (!parsed.success) return { error: z.prettifyError(parsed.error) };

  // The schema checked every handler is a function; `Hook` gives their signatures.
  return { hook: parsed.data as Hook };
}

/**
 * Turns a failed `import()` of a hook file into advice. Plain `.js`/`.ts` follow the project's
 * package.json `"type"`, so a hook written in the other module format fails; the fix is the
 * explicit extension.
 */
export function explainImportError(params: { file: string; caughtError: unknown }): string {
  const { file, caughtError } = params;
  const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
  const code = (caughtError as { code?: unknown } | undefined)?.code;
  const typescript = /\.[cm]?ts$/.test(file);

  if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    return `${message}\nNode runs TypeScript by removing the types, so only erasable syntax works: no enum, namespace or constructor parameter properties.`;
  }

  if (/\b(module|exports|require) is not defined in ES module scope/.test(message)) {
    return `${message}\nThis file uses CommonJS, but the project's package.json makes it ESM. Rename it to ${typescript ? '.cts' : '.cjs'}, or use export default.`;
  }

  if (/Unexpected token 'export'|Cannot use import statement outside a module/.test(message)) {
    return `${message}\nThis file uses ESM, but the project's package.json makes it CommonJS. Rename it to ${typescript ? '.mts' : '.mjs'}, or use module.exports.`;
  }

  return message;
}
