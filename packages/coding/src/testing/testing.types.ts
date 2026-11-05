import type { AllowEntry, PermissionMode } from '@sheavly/protocol/permission/permission.types';
import type { CommandPermissions } from '../run-command/run-command.types.js';

/** Test-only: in-memory permissions, which a test can change between commands like a user can. */
export type TestPermissions = CommandPermissions & {
  setMode(mode: PermissionMode): void;
  /** What `allow` has kept so far, in order. */
  readonly kept: AllowEntry[];
};
