import type {
  AllowEntry,
  PermissionMode,
  Permissions,
} from '@sheavly/protocol/permission/permission.types';
import type { TestPermissions } from './testing.types.js';

export function testPermissions(start: Partial<Permissions> = {}): TestPermissions {
  let mode: PermissionMode = start.mode ?? 'ask';
  const allowed = [...(start.allow ?? [])];
  const kept: AllowEntry[] = [];

  return {
    read: () => Promise.resolve({ mode, allow: [...allowed] }),
    allow: (entry) => {
      allowed.push(entry);
      kept.push(entry);

      return Promise.resolve();
    },
    setMode: (next) => {
      mode = next;
    },
    kept,
  };
}
