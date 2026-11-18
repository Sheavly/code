import type { Environment } from '@sheavly/core/environment/environment.types';
import type { OutputStore } from '@sheavly/core/output/output.types';
import type { DocumentStore } from '@sheavly/core/store/store.types';
import type { Extension } from '@sheavly/extension/extension/extension.types';
import type { Harness } from '@sheavly/host/host/host.types';
import type { KeyedLocks } from '@sheavly/runtime/locks/keyed-locks.service';
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

/** What a test decides about its coding run (`codingRun`); the rest is the same for every test. */
export type CodingRunParams = {
  /** The workspace root; the trust file pretends to live beside it. */
  project: string;
  scratchRoot?: string | undefined;
  fileLocks?: KeyedLocks | undefined;
  outputs?: OutputStore | undefined;
  /** The conversation's shell store; give one to share it between runs. Default: its own. */
  shell?: DocumentStore | undefined;
  /** An existing harness (a reopened conversation); default: a new one. */
  harness?: Harness | undefined;
  /** What the user lets `run_command` do. Default: `testPermissions()` (asks). */
  permissions?: CommandPermissions | undefined;
  /** The environment commands start from. Default: empty. */
  env?: Environment | undefined;
  /** Changes the coding extension before it is activated (a manifest that lacks a grant). */
  adjust?: ((coding: Extension) => Extension) | undefined;
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
