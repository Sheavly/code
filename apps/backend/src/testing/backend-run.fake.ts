import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { CommandPermissions } from '@sheavly/coding/run-command/run-command.types';
import { TrustStore } from '@sheavly/coding/trust/trust.service';
import { memoryTrust } from '@sheavly/coding/testing/trust.fake';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { OutputStore } from '@sheavly/core/output/output.types';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { EntryStore } from '@sheavly/core/store/store.types';
import type { StoredLog } from '@sheavly/runtime/sessions/sessions.types';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';
import { createBackendHarness } from '../harness/harness.helper.js';
import { askingPermissions } from './permissions.fake.js';

type BackendRunParams = Parameters<typeof openBackendRun>[0];

/**
 * Test-only: registers a temporary workspace folder per test (made before, removed after) and
 * returns the function that opens a backend run in it. Call it at the top of a describe or file.
 */
export function useBackendRuns() {
  let base = '';

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'backend-run-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  return (params: Omit<BackendRunParams, 'base'>) => openBackendRun({ base, ...params });
}

/**
 * Test-only: a backend run in `base` with no web tools (unless asked) and a scripted provider, adding the given
 * `extensions` the way an embedding app does. The default script answers `done` to `go`.
 */
export function openBackendRun(params: {
  base: string;
  extensions: Parameters<typeof createBackendHarness>[0]['extensions'];
  /** The user's global and profile layers, already read. */
  settingLayers?: Parameters<typeof createBackendHarness>[0]['settingLayers'];
  /** The workspace trust (default: an in-memory one that trusts nothing, kept outside `base`). */
  trustStore?: TrustStore;
  /** `--trust`. */
  trustWorkspace?: boolean;
  /** The environment the run starts from (default: empty, so the user's folder is the real home's). */
  env?: Environment;
  scripts?: Record<string, Script[]>;
  outputs?: OutputStore | undefined;
  /** The web tools, off unless a test turns them on. */
  webFetch?: Parameters<typeof createBackendHarness>[0]['webFetch'];
  webSearch?: Parameters<typeof createBackendHarness>[0]['webSearch'];
  /** What `run_command` consults; asks about every command and keeps nothing by default. */
  permissions?: CommandPermissions;
  onModelCall?: (request: ProviderRequest) => void;
  onExtensionProblem?: (caughtError: unknown) => void;
  /** The app's own system-prompt extras and replacement base (`BackendHarnessOptions`). */
  instructions?: string | undefined;
  baseInstructions?: string | undefined;
  omitInstructionSections?: readonly string[] | undefined;
  /** Keeps the run's combined stream in this store, and `resume` carries on a stored one. */
  entries?: EntryStore;
  resume?: StoredLog;
}) {
  return createBackendHarness({
    provider: routedProvider(params.scripts ?? { go: [say('done')] }),
    title: 'go',
    workspaceRoot: params.base,
    // The store's file must lie outside the workspace, or the store refuses to be consulted.
    trustStore:
      params.trustStore ??
      new TrustStore({
        persistence: memoryTrust({ file: path.join(path.dirname(params.base), 'trusted.json') }),
      }),
    trustWorkspace: params.trustWorkspace ?? false,
    env: params.env ?? {},
    permissions: params.permissions ?? askingPermissions(),
    webFetch: params.webFetch ?? false,
    webSearch: params.webSearch ?? false,
    extensions: params.extensions,
    settingLayers: params.settingLayers,
    outputs: params.outputs,
    onModelCall: params.onModelCall,
    onExtensionProblem: params.onExtensionProblem,
    instructions: params.instructions,
    baseInstructions: params.baseInstructions,
    omitInstructionSections: params.omitInstructionSections,
    entries: params.entries,
    resume: params.resume,
  });
}
