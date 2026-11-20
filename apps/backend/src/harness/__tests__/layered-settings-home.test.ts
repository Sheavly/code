import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TrustStore } from '@sheavly/coding/trust/trust.service';
import { memoryTrust } from '@sheavly/coding/testing/trust.fake';
import { openBackendRun } from '../../testing/backend-run.fake.js';
import { notes, settingInfo, useLayeredProject } from '../../testing/layered-settings.fake.js';
import { readUserSettingLayers } from '../setting-layers.helper.js';

const PROFILE = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const layered = useLayeredProject();

/** The user's home as the workspace, with their `SHEAVLY_HOME` (`<home>/.sheavly`) holding a global file and the trust store. */
async function userHomeAsWorkspace() {
  const workspace = path.join(layered.base(), 'userhome');
  const home = path.join(workspace, '.sheavly');
  const env = { SHEAVLY_HOME: home };

  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, 'settings.json'),
    JSON.stringify({ settings: { 'notes.max-lines': 7 } }),
  );

  // The real arrangement: the store sits in the user's folder, which here lies inside the workspace.
  const trustStore = new TrustStore({
    persistence: memoryTrust({ file: path.join(home, 'trusted-workspaces.json') }),
  });

  return { workspace, home, env, trustStore };
}

describe('a workspace that is the user’s home', () => {
  it.each([false, true])(
    'starts with the global file as the global layer only, with --trust %s',
    async (trustWorkspace) => {
      const { workspace, env, trustStore } = await userHomeAsWorkspace();
      const check = vi.spyOn(trustStore, 'check');
      const trust = vi.spyOn(trustStore, 'trust');
      const harness = await openBackendRun({
        base: workspace,
        extensions: [notes],
        env,
        trustStore,
        trustWorkspace,
        settingLayers: await readUserSettingLayers({ env, profile: PROFILE }),
      });

      expect(settingInfo(harness, 'notes.max-lines')).toMatchObject({ value: 7, source: 'global' });
      expect(harness.ignoredSettings).toEqual([]);
      expect(harness.ignoredSettingsMore).toBe(0);
      expect(check).not.toHaveBeenCalled();
      expect(trust).not.toHaveBeenCalled();
    },
  );

  it('starts and reports trust-unavailable for a workspace that is only a parent of the home', async () => {
    const workspace = path.join(layered.base(), 'parent');
    const home = path.join(workspace, 'user', '.sheavly');
    const file = path.join(workspace, '.sheavly', 'settings.json');

    await mkdir(home, { recursive: true });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ settings: { 'notes.mode': 'from-parent' } }));

    // The real store sits in the user's folder, which lies inside this workspace, so it refuses.
    const trustStore = new TrustStore({
      persistence: memoryTrust({ file: path.join(home, 'trusted-workspaces.json') }),
    });
    const harness = await openBackendRun({
      base: workspace,
      extensions: [notes],
      env: { SHEAVLY_HOME: home },
      trustStore,
      settingLayers: {},
    });

    expect(harness.ignoredSettings).toEqual([
      { layer: 'workspace', file, reason: 'trust-unavailable' },
    ]);
    expect(settingInfo(harness, 'notes.mode')).toMatchObject({
      value: 'from-parent',
      source: 'workspace',
    });
  });

  it('still reads a project file there when the user’s folder is somewhere else', async () => {
    const { workspace } = await userHomeAsWorkspace();
    const elsewhere = path.join(layered.base(), 'other-home');
    const harness = await openBackendRun({
      base: workspace,
      extensions: [notes],
      env: { SHEAVLY_HOME: elsewhere },
      trustStore: layered.trustStore(),
      settingLayers: {},
    });

    // Its `.sheavly/settings.json` now is a project file, and a user-scope setting in it is ignored.
    expect(harness.ignoredSettings).toEqual([
      {
        layer: 'workspace',
        name: 'notes.max-lines',
        file: path.join(workspace, '.sheavly', 'settings.json'),
        reason: 'scope',
      },
    ]);
  });
});
