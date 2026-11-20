import { describe, expect, it, vi } from 'vitest';
import { TrustStoreError } from '@sheavly/coding/errors/trust.errors';
import type { TrustState } from '@sheavly/coding/trust/trust.types';
import {
  settingInfo,
  trustStoreBeside,
  useLayeredProject,
} from '../../testing/layered-settings.fake.js';
import { TEST_SECRET } from '../../testing/testing.constants.js';
import type { OpenedRun } from '../../testing/testing.types.js';
import { ignoredSettingLines } from '../setting-layers.utils.js';

const layered = useLayeredProject();

const trustFailure = () =>
  new TrustStoreError({ file: `/home/${TEST_SECRET}/trusted.json`, cause: new Error(TEST_SECRET) });
const fileSystemFailure = () =>
  Object.assign(new Error(`EACCES: permission denied, open '/x/${TEST_SECRET}'`), {
    code: 'EACCES',
  });

/** A workspace file with a restricted and a plain project value, so trust decides one and not the other. */
const writeBothValues = () =>
  layered.workspaceValues({ 'notes.dangerous': true, 'notes.mode': 'from-workspace' });

/** The restricted value is ignored, the plain project value honoured, and the trust step reported. */
function expectUntrustedAndReported(harness: OpenedRun) {
  const file = layered.workspaceFile();

  expect(settingInfo(harness, 'notes.dangerous')).toMatchObject({
    value: false,
    source: 'default',
  });
  expect(settingInfo(harness, 'notes.mode')).toMatchObject({
    value: 'from-workspace',
    source: 'workspace',
  });
  expect(harness.ignoredSettings).toEqual([
    { layer: 'workspace', file, reason: 'trust-unavailable' },
    { layer: 'workspace', name: 'notes.dangerous', file, reason: 'restricted' },
  ]);
}

describe('a program error in the trust step', () => {
  const programError = () =>
    Object.assign(new TypeError('The "path" argument must be of type string'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });

  it('fails the start when check throws it', async () => {
    await writeBothValues();
    vi.spyOn(layered.trustStore(), 'check').mockRejectedValue(programError());

    await expect(layered.open()).rejects.toThrow('The "path" argument');
  });

  it('fails the start when trust throws it under --trust', async () => {
    await writeBothValues();
    vi.spyOn(layered.trustStore(), 'trust').mockRejectedValue(programError());

    await expect(layered.open({ trustWorkspace: true })).rejects.toThrow('The "path" argument');
  });

  it('fails the start when the check after the read throws it', async () => {
    await writeBothValues();
    vi.spyOn(layered.trustStore(), 'check')
      .mockResolvedValueOnce('trusted')
      .mockRejectedValueOnce(programError());

    await expect(layered.open()).rejects.toThrow('The "path" argument');
  });
});

describe('the two trust checks around the read', () => {
  it.each<[TrustState, TrustState]>([
    ['trusted', 'changed'],
    ['changed', 'trusted'],
    ['untrusted', 'trusted'],
    ['untrusted', 'untrusted'],
  ])('ignores a restricted setting when the checks say %s then %s', async (first, second) => {
    await writeBothValues();

    const check = vi
      .spyOn(layered.trustStore(), 'check')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const harness = await layered.open();

    expect(check).toHaveBeenCalledTimes(2);
    expect(settingInfo(harness, 'notes.dangerous')).toMatchObject({
      value: false,
      source: 'default',
    });
    expect(settingInfo(harness, 'notes.mode')).toMatchObject({ value: 'from-workspace' });
    expect(harness.ignoredSettings).toEqual([
      {
        layer: 'workspace',
        name: 'notes.dangerous',
        file: layered.workspaceFile(),
        reason: 'restricted',
      },
    ]);
  });

  it('honours a restricted setting only when both checks say trusted', async () => {
    await writeBothValues();
    vi.spyOn(layered.trustStore(), 'check')
      .mockResolvedValueOnce('trusted')
      .mockResolvedValueOnce('trusted');

    const harness = await layered.open();

    expect(settingInfo(harness, 'notes.dangerous')).toMatchObject({
      value: true,
      source: 'workspace',
    });
    expect(harness.ignoredSettings).toEqual([]);
  });
});

describe('a trust step that fails', () => {
  type TrustFailureCase = [string, 'check' | 'trust', () => Error, boolean];
  const failures: TrustFailureCase[] = [
    ['a store error on check', 'check', trustFailure, false],
    ['a file system error on check', 'check', fileSystemFailure, false],
    ['a store error on trust with --trust', 'trust', trustFailure, true],
    ['a file system error on trust with --trust', 'trust', fileSystemFailure, true],
  ];

  it.each(failures)(
    'starts, treats the workspace as untrusted and reports trust-unavailable: %s',
    async (_name, method, failure, trustWorkspace) => {
      await writeBothValues();
      vi.spyOn(layered.trustStore(), method).mockRejectedValue(failure());

      const harness = await layered.open({ trustWorkspace });
      const lines = ignoredSettingLines({ ignored: harness.ignoredSettings, more: 0 });
      const file = layered.workspaceFile();

      expectUntrustedAndReported(harness);
      expect(lines[0]).toBe(`settings: ignored ${file}: trust-unavailable`);
      expect(JSON.stringify([harness.ignoredSettings, harness.settings, lines])).not.toContain(
        'SECRET',
      );
    },
  );

  it('reports a failure of the check after the read, and ignores the restricted setting', async () => {
    await writeBothValues();
    vi.spyOn(layered.trustStore(), 'check')
      .mockResolvedValueOnce('trusted')
      .mockRejectedValueOnce(trustFailure());

    const harness = await layered.open();

    expect(harness.ignoredSettings.map(({ reason }) => reason)).toEqual([
      'trust-unavailable',
      'restricted',
    ]);
    expect(settingInfo(harness, 'notes.mode')).toMatchObject({ source: 'workspace' });
  });

  it('reports a failure of the check after the read under --trust, where trust succeeded', async () => {
    await writeBothValues();

    const store = layered.trustStore();

    vi.spyOn(store, 'trust').mockResolvedValue(undefined);

    const check = vi.spyOn(store, 'check').mockRejectedValue(fileSystemFailure());
    const harness = await layered.open({ trustWorkspace: true });

    expect(check).toHaveBeenCalledTimes(1);
    expectUntrustedAndReported(harness);
  });

  it('still reads a file that cannot be used, and reports both problems', async () => {
    await layered.writeWorkspaceFile('{ not json');
    vi.spyOn(layered.trustStore(), 'check').mockRejectedValue(trustFailure());

    const harness = await layered.open();

    expect(harness.ignoredSettings).toEqual([
      { layer: 'workspace', file: layered.workspaceFile(), reason: 'not-json' },
      { layer: 'workspace', file: layered.workspaceFile(), reason: 'trust-unavailable' },
    ]);
  });

  it('starts when the trust store lives inside the repository, as the real store refuses', async () => {
    await writeBothValues();

    const harness = await layered.open({ trustStore: trustStoreBeside(layered.project()) });

    expect(harness.ignoredSettings.map(({ reason }) => reason)).toEqual([
      'trust-unavailable',
      'restricted',
    ]);
    expect(settingInfo(harness, 'notes.mode')).toMatchObject({ value: 'from-workspace' });
  });
});
