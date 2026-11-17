import { defineHook } from '@sheavly/core/hook/hook.utils';
import { defineTool } from '@sheavly/core/tool/tool.utils';
import { z } from 'zod';
import type { Extension } from '../extension/extension.types.js';
import { defineExtension } from '../extension/extension.utils.js';

/** A tool with the given name that answers `ok`, for tests that only care that it was contributed. */
export function fakeTool(name: string) {
  return defineTool({
    name,
    description: `Fake tool ${name}`,
    inputSchema: z.object({}),
    execute: async () => 'ok',
  });
}

/** A hook with the given name that handles `sessionStart` and adds nothing. */
export function fakeHook(name: string) {
  return defineHook({ name, sessionStart: async () => undefined });
}

/**
 * A builtin extension that contributes nothing, with `fields` laid over it. Tests that need
 * contributions pass their own `activate`.
 */
export function fakeExtension(fields: Partial<Extension> & { name: string }): Extension {
  return defineExtension({ activate: () => ({}), ...fields });
}
