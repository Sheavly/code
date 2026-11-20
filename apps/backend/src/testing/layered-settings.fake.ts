import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { memoryTrust } from '@sheavly/coding/testing/trust.fake';
import { TrustStore } from '@sheavly/coding/trust/trust.service';
import type { Environment } from '@sheavly/core/environment/environment.types';
import type { SettingValue } from '@sheavly/extension/extension/extension.types';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import { manifestOf } from './manifest.fake.js';
import { openBackendRun } from './backend-run.fake.js';
import type { OpenedRun } from './testing.types.js';

/** `notes` declares a user setting, a project one and a project one that needs a trusted workspace. */
export const notes = defineExtension({
  manifest: manifestOf({
    name: 'notes',
    settings: [
      {
        name: 'notes.max-lines',
        type: 'number',
        default: 50,
        description: 'Lines',
        scope: 'user',
        restricted: false,
      },
      {
        name: 'notes.mode',
        type: 'string',
        default: 'plain',
        description: 'Mode',
        scope: 'project',
        restricted: false,
      },
      {
        name: 'notes.dangerous',
        type: 'boolean',
        default: false,
        description: 'Dangerous',
        scope: 'project',
        restricted: true,
      },
    ],
  }),
  activate: () => ({}),
});

/** A trust store that lives beside `folder`, outside it, as the real one does. */
export const trustStoreBeside = (folder: string) =>
  new TrustStore({ persistence: memoryTrust({ file: path.join(folder, 'trusted.json') }) });

/** A settings layer as `readUserSettingLayers` makes it. */
const settingLayer = (source: string, values: Record<string, SettingValue>) => ({
  source,
  values,
});

/**
 * Test-only: a temporary `base` with a `project` folder in it per test (made before, removed
 * after), a trust store beside the project, and `open`, which opens a backend run over the project
 * with the `notes` extension. Call it at the top of a describe or file.
 */
export function useLayeredProject() {
  let base = '';
  let project = '';
  let trustStore = trustStoreBeside('/unused');

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'layered-settings-'));
    trustStore = trustStoreBeside(base);
    project = path.join(base, 'project');
    await mkdir(project, { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const workspaceFile = () => path.join(project, '.sheavly', 'settings.json');
  const writeWorkspaceFile = async (text: string | Uint8Array) => {
    await mkdir(path.join(project, '.sheavly'), { recursive: true });
    await writeFile(workspaceFile(), text);
  };

  return {
    base: () => base,
    project: () => project,
    trustStore: () => trustStore,
    workspaceFile,
    writeWorkspaceFile,
    workspaceValues: (values: Record<string, SettingValue>) =>
      writeWorkspaceFile(JSON.stringify({ settings: values })),
    open: (
      params: {
        global?: Record<string, SettingValue>;
        profile?: Record<string, SettingValue>;
        trustWorkspace?: boolean;
        trustStore?: TrustStore;
        env?: Environment;
        base?: string;
      } = {},
    ) =>
      openBackendRun({
        base: params.base ?? project,
        extensions: [notes],
        trustStore: params.trustStore ?? trustStore,
        trustWorkspace: params.trustWorkspace ?? false,
        ...(params.env && { env: params.env }),
        settingLayers: {
          ...(params.global && {
            global: settingLayer('/home/.sheavly/settings.json', params.global),
          }),
          ...(params.profile && {
            profile: settingLayer('/home/.sheavly/profiles/p/settings.json', params.profile),
          }),
        },
      }),
  };
}

/** The run's setting `name`, as the run reports it. */
export const settingInfo = (harness: OpenedRun, name: string) =>
  harness.settings.find((setting) => setting.name === name);
