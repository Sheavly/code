import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_IGNORED_SETTING_FILE_CHARS } from '@sheavly/protocol/server/server.constants';
import { ignoredSettingSchema } from '@sheavly/protocol/server/server.validator';
import { useLayeredProject } from '../../testing/layered-settings.fake.js';
import { ignoredSettingLines, reportedFile } from '../setting-layers.utils.js';

const layered = useLayeredProject();

/** A workspace file with `count` entries no extension declares, each one an ignored entry. */
const undeclared = (count: number) =>
  layered.workspaceValues(
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`nobody.n${index}`, index])),
  );

describe('how many ignored entries a run reports', () => {
  it('lists at most 20 and counts the rest, in the harness and in the log', async () => {
    await undeclared(300);

    const harness = await layered.open();
    const lines = ignoredSettingLines({
      ignored: harness.ignoredSettings,
      more: harness.ignoredSettingsMore,
    });

    expect(harness.ignoredSettings).toHaveLength(20);
    expect(harness.ignoredSettingsMore).toBe(280);
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe(`settings: ignored 280 more entries from ${layered.workspaceFile()}`);
  });

  it.each([
    [20, 0],
    [21, 1],
  ])('with %s entries leaves %s out', async (count, more) => {
    await undeclared(count);

    const harness = await layered.open();

    expect(harness.ignoredSettings).toHaveLength(Math.min(count, 20));
    expect(harness.ignoredSettingsMore).toBe(more);
  });
});

describe('the file path in a report', () => {
  it('has control characters and escape sequences removed, in the wire entry and the log line', async () => {
    const hostile = path.join(layered.base(), 'evil\u001b[31m\nname\u0007\u007f');

    await mkdir(path.join(hostile, '.sheavly'), { recursive: true });
    await writeFile(path.join(hostile, '.sheavly', 'settings.json'), '{ not json');

    const harness = await layered.open({ base: hostile });
    const [entry] = harness.ignoredSettings;
    const [line] = ignoredSettingLines({ ignored: harness.ignoredSettings, more: 0 });
    const expected = path.join(layered.base(), 'evilname', '.sheavly', 'settings.json');

    expect(entry).toEqual({ layer: 'workspace', file: expected, reason: 'not-json' });
    expect(line).toBe(`settings: ignored ${expected}: not-json`);
    expect(`${entry?.file}${line}`).not.toMatch(/\p{Cc}/u);
  });

  it('is cut at its start to fit the wire, so a long path never fails the details', () => {
    const long = `/${'a'.repeat(9000)}/.sheavly/settings.json`;
    const shown = reportedFile(long);

    expect(shown).toHaveLength(MAX_IGNORED_SETTING_FILE_CHARS);
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.endsWith('/.sheavly/settings.json')).toBe(true);
    expect(
      ignoredSettingSchema.safeParse({ layer: 'workspace', file: shown, reason: 'not-json' })
        .success,
    ).toBe(true);
  });

  it('is left alone when it is clean and fits', () => {
    expect(reportedFile('/w/.sheavly/settings.json')).toBe('/w/.sheavly/settings.json');
  });
});
