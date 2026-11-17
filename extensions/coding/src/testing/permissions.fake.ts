import type {
  AllowEntry,
  PermissionMode,
  Permissions,
} from '@sheavly/protocol/permission/permission.types';
import type { TestPermissions } from './testing.types.js';

export function testPermissions(
  start: Partial<Permissions> = {},
  session = false,
): TestPermissions {
  let mode: PermissionMode = start.mode ?? 'ask';
  const allowed = [...(start.allow ?? [])];
  const kept: AllowEntry[] = [];
  const sessionKept: AllowEntry[] = [];

  return {
    read: () => Promise.resolve({ mode, allow: [...allowed, ...sessionKept] }),
    allow: (entry) => {
      allowed.push(entry);
      kept.push(entry);

      return Promise.resolve();
    },
    setMode: (next) => {
      mode = next;
    },
    kept,
    sessionKept,
    ...(session && {
      allowSession: (entry: AllowEntry) => {
        sessionKept.push(entry);

        return Promise.resolve();
      },
    }),
  };
}
