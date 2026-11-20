import { mkdir } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { useLayeredProject, settingInfo } from '../../testing/layered-settings.fake.js';
import { TEST_SECRET } from '../../testing/testing.constants.js';
import type { OpenedRun } from '../../testing/testing.types.js';
import { ignoredSettingLines } from '../setting-layers.utils.js';

const layered = useLayeredProject();

/** The restricted setting the workspace file sets stayed at its default and was reported. */
function expectDangerousIgnored(harness: OpenedRun): void {
  expect(settingInfo(harness, 'notes.dangerous')).toMatchObject({
    value: false,
    source: 'default',
  });
  expect(harness.ignoredSettings).toEqual([
    {
      layer: 'workspace',
      name: 'notes.dangerous',
      file: layered.workspaceFile(),
      reason: 'restricted',
    },
  ]);
}

describe('layered settings through the backend harness', () => {
  it('lets global win over profile, profile over workspace, and workspace over the default', async () => {
    await layered.workspaceValues({ 'notes.mode': 'from-workspace', 'notes.dangerous': false });
    const profile = { 'notes.mode': 'from-profile', 'notes.dangerous': true };

    const all = await layered.open({
      global: { 'notes.mode': 'from-global' },
      profile,
      trustWorkspace: true,
    });
    const noGlobal = await layered.open({ profile, trustWorkspace: true });
    const onlyWorkspace = await layered.open({ trustWorkspace: true });

    expect(settingInfo(all, 'notes.mode')).toMatchObject({
      value: 'from-global',
      source: 'global',
    });
    expect(settingInfo(all, 'notes.dangerous')).toMatchObject({ value: true, source: 'profile' });
    expect(settingInfo(all, 'notes.max-lines')).toMatchObject({ value: 50, source: 'default' });
    expect(settingInfo(noGlobal, 'notes.mode')).toMatchObject({
      value: 'from-profile',
      source: 'profile',
    });
    expect(settingInfo(onlyWorkspace, 'notes.mode')).toMatchObject({
      value: 'from-workspace',
      source: 'workspace',
    });
    expect(settingInfo(onlyWorkspace, 'notes.dangerous')).toMatchObject({
      value: false,
      source: 'workspace',
    });
  });

  it('ignores a workspace value for a user setting and reports it with its reason', async () => {
    await layered.workspaceValues({ 'notes.max-lines': 9 });

    const harness = await layered.open();

    expect(settingInfo(harness, 'notes.max-lines')).toMatchObject({ value: 50, source: 'default' });
    expect(harness.ignoredSettings).toEqual([
      {
        layer: 'workspace',
        name: 'notes.max-lines',
        file: layered.workspaceFile(),
        reason: 'scope',
      },
    ]);
  });

  it('honours a non-restricted project setting even when the workspace is untrusted', async () => {
    await layered.workspaceValues({ 'notes.mode': 'from-workspace' });

    const harness = await layered.open();

    expect(settingInfo(harness, 'notes.mode')).toMatchObject({ value: 'from-workspace' });
    expect(harness.ignoredSettings).toEqual([]);
  });

  describe('a restricted project setting', () => {
    it('is ignored and reported while the workspace is untrusted', async () => {
      await layered.workspaceValues({ 'notes.dangerous': true });

      expectDangerousIgnored(await layered.open());
    });

    it('is honoured when --trust grants trust', async () => {
      await layered.workspaceValues({ 'notes.dangerous': true });

      const harness = await layered.open({ trustWorkspace: true });

      expect(settingInfo(harness, 'notes.dangerous')).toMatchObject({
        value: true,
        source: 'workspace',
      });
      expect(harness.ignoredSettings).toEqual([]);
    });

    it('is honoured when the trust store holds a grant, and ignored again once .sheavly/ changed', async () => {
      await layered.workspaceValues({ 'notes.dangerous': true });
      await layered.trustStore().trust({ root: layered.project() });

      const trusted = await layered.open();

      expect(settingInfo(trusted, 'notes.dangerous')).toMatchObject({
        value: true,
        source: 'workspace',
      });

      await layered.workspaceValues({ 'notes.dangerous': true, 'notes.mode': 'edited' });

      const changed = await layered.open();

      expect(await layered.trustStore().check({ root: layered.project() })).toBe('changed');
      expectDangerousIgnored(changed);
    });
  });

  it('records trust with --trust for a repository that has only a settings.json', async () => {
    await layered.workspaceValues({ 'notes.dangerous': true });
    await layered.open({ trustWorkspace: true });

    expect(await layered.trustStore().check({ root: layered.project() })).toBe('trusted');
    expect(settingInfo(await layered.open(), 'notes.dangerous')).toMatchObject({ value: true });
  });

  it('never consults the trust store, and reports nothing, when there is no workspace file', async () => {
    const check = vi.spyOn(layered.trustStore(), 'check');
    const trust = vi.spyOn(layered.trustStore(), 'trust');
    const harness = await layered.open({ trustWorkspace: false });

    expect(check).not.toHaveBeenCalled();
    expect(trust).not.toHaveBeenCalled();
    expect(harness.ignoredSettings).toEqual([]);
    expect(harness.ignoredSettingsMore).toBe(0);
  });

  describe('a workspace file that cannot be used', () => {
    const bad: [string, string | Uint8Array, string][] = [
      ['not JSON', `{"settings": {"notes.mode": "${TEST_SECRET}"`, 'not-json'],
      ['the wrong shape', JSON.stringify({ settings: [TEST_SECRET] }), 'bad-shape'],
      [
        'an entry with a __proto__ key',
        `{"settings": {"__proto__": "${TEST_SECRET}"}}`,
        'bad-shape',
      ],
      ['a stray top-level key', JSON.stringify({ apiKey: TEST_SECRET }), 'bad-shape'],
      [
        'oversize',
        JSON.stringify({ settings: { 'notes.mode': `${TEST_SECRET}${'x'.repeat(70_000)}` } }),
        'too-large',
      ],
      ['not UTF-8', Buffer.from([...Buffer.from(TEST_SECRET), 0xff, 0xfe, 0xc3]), 'not-utf8'],
    ];

    it.each(bad)(
      'is an empty layer, reported with its file and a fixed cause, and never echoed: %s',
      async (_name, text, reason) => {
        await layered.writeWorkspaceFile(text);

        const harness = await layered.open();
        const lines = ignoredSettingLines({ ignored: harness.ignoredSettings, more: 0 });
        const everything = JSON.stringify([harness.ignoredSettings, harness.settings, lines]);

        expect(harness.ignoredSettings).toEqual([
          { layer: 'workspace', file: layered.workspaceFile(), reason },
        ]);
        expect(lines).toEqual([`settings: ignored ${layered.workspaceFile()}: ${reason}`]);
        expect(settingInfo(harness, 'notes.mode')).toMatchObject({
          value: 'plain',
          source: 'default',
        });
        expect(everything).not.toContain('SECRET');
        expect(Object.keys(Object.prototype)).toEqual([]);
      },
    );

    it('is reported as not-a-file when it is a folder', async () => {
      await mkdir(layered.workspaceFile(), { recursive: true });

      const harness = await layered.open();

      expect(harness.ignoredSettings).toEqual([
        { layer: 'workspace', file: layered.workspaceFile(), reason: 'not-a-file' },
      ]);
    });
  });

  it('ignores an undeclared name or a wrong type in the workspace file, naming only the name', async () => {
    await layered.workspaceValues({ 'openai.api-key': TEST_SECRET, 'notes.mode': 3 });

    const harness = await layered.open();
    const lines = ignoredSettingLines({ ignored: harness.ignoredSettings, more: 0 });
    const file = layered.workspaceFile();

    expect(harness.ignoredSettings).toEqual([
      { layer: 'workspace', name: 'openai.api-key', file, reason: 'not-declared' },
      { layer: 'workspace', name: 'notes.mode', file, reason: 'wrong-type' },
    ]);
    expect(lines[0]).toBe(`settings: ignored openai.api-key from ${file}: not-declared`);
    expect(JSON.stringify([harness.ignoredSettings, harness.settings, lines])).not.toContain(
      TEST_SECRET,
    );
  });

  it('fails the start on an undeclared name or a wrong type in the global or profile layer', async () => {
    await expect(layered.open({ global: { 'nobody.declares': 1 } })).rejects.toThrow(
      /nobody\.declares.*settings\.json/,
    );
    await expect(layered.open({ profile: { 'notes.mode': 3 } })).rejects.toThrow(
      /notes\.mode.*profiles\/p\/settings\.json/,
    );
  });
});
