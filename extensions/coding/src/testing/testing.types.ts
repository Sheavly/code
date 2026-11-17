import type { AllowEntry, PermissionMode } from '@sheavly/protocol/permission/permission.types';
import type { CommandPermissions } from '../run-command/run-command.types.js';
import type { TrustPersistence } from '../trust/trust.types.js';

/** Test-only: in-memory permissions, which a test can change between commands like a user can. */
export type TestPermissions = CommandPermissions & {
  setMode(mode: PermissionMode): void;
  /** What `allow` has kept so far, in order. */
  readonly kept: AllowEntry[];
  readonly sessionKept: AllowEntry[];
};

/** The skill folders from `useSkillFolders`; readable only while its tests run. */
export type SkillFolders = {
  /** The temp dir; holds `project/` and `home/`. */
  readonly base: string;
  /** The project root, with `.sheavly/skills/` and `.agents/skills/`. */
  readonly root: string;
  /** The user's home, with `.sheavly/skills/` and `.agents/skills/`. */
  readonly home: string;
};

/** A `TrustPersistence` in memory (`memoryTrust`), and the ways a test can make it misbehave. */
export type MemoryTrust = TrustPersistence & {
  /** Sets the stored document as a file would hold it (any JSON, or `undefined` for none). */
  set(document: unknown): void;
  /** The stored document now. */
  get(): unknown;
  /** Makes `load` and `update` reject with `error`; `undefined` mends it. */
  failWith(error: Error | undefined): void;
};
