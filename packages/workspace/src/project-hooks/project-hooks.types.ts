import type { z } from 'zod';
import type { Hook } from '@sheavly/core/hook/hook.types';
import type { TrustState } from '../trust/trust.types.js';
import type { hooksManifestSchema } from './project-hooks.validator.js';

/** `.sheavly/hooks.json`, after validation (`enabled` defaults to true). */
export type HooksManifest = z.infer<typeof hooksManifestSchema>;

/** A workspace's trust, as far as its hooks go: `no_hooks` when it has no `.sheavly/hooks.json`. */
export type ProjectTrust = TrustState | 'no_hooks';

/**
 * What `loadProjectHooks` found. `hooks` is empty unless `trust` is `trusted`; a host shows the
 * user why when it's `untrusted` or `changed`.
 */
export type ProjectHooks = { hooks: Hook[]; trust: ProjectTrust };
