import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';

/** Test-only: permissions that ask about every command and keep nothing, for a run that never runs one. */
export function askingPermissions(): CommandPermissions {
  return {
    read: () => Promise.resolve({ mode: 'ask', allow: [] }),
    allow: () => Promise.resolve(),
  };
}
