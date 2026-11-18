import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import type { AllowEntry } from '@sheavly/protocol/permission/permission.types';

/**
 * Test-only: `ask` mode with nothing allowed, offering both grants, that records the entries the
 * user kept for good (`allowed`) and for the session (`sessionAllowed`).
 */
export function recordingPermissions(): CommandPermissions & {
  allowed: AllowEntry[];
  sessionAllowed: AllowEntry[];
} {
  const allowed: AllowEntry[] = [];
  const sessionAllowed: AllowEntry[] = [];

  return {
    allowed,
    sessionAllowed,
    read: () => Promise.resolve({ mode: 'ask', allow: [] }),
    allow: (entry) => Promise.resolve(void allowed.push(entry)),
    allowSession: (entry) => Promise.resolve(void sessionAllowed.push(entry)),
  };
}

/** Test-only: permissions that ask about every command and keep nothing, for a run that never runs one. */
export function askingPermissions(): CommandPermissions {
  return {
    read: () => Promise.resolve({ mode: 'ask', allow: [] }),
    allow: () => Promise.resolve(),
  };
}
