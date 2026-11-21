import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishDiscoveryFile } from '../publish-discovery-file.helper.js';
import { removeDiscoveryFile } from '../remove-discovery-file.helper.js';
import {
  deadProcessId,
  plantFile,
  sampleDiscoveryFile,
  tempFileName,
  useDiscoveryFolder,
} from '../testing/discovery-file.fake.js';

const folder = useDiscoveryFolder();
const { uid } = folder;
const ours = sampleDiscoveryFile();
const successor = sampleDiscoveryFile({ instanceId: 'B'.repeat(43), pid: 77 });

describe('removeDiscoveryFile', () => {
  it('removes the file of its own instance', async () => {
    const directory = await folder.directory();

    await publishDiscoveryFile({ directory, uid, value: ours });

    expect(await removeDiscoveryFile({ directory, uid, instanceId: ours.instanceId })).toEqual({
      status: 'removed',
    });
    expect(await folder.names(directory)).toEqual([]);
  });

  it('leaves the file of a successor alone', async () => {
    const directory = await folder.directory();

    await publishDiscoveryFile({ directory, uid, value: successor });

    expect(await removeDiscoveryFile({ directory, uid, instanceId: ours.instanceId })).toEqual({
      status: 'left',
      reason: 'not-ours',
    });
    expect(JSON.parse(await readFile(path.join(directory, 'server.json'), 'utf8'))).toEqual(
      successor,
    );
  });

  it('says so when there is no file, and does not throw for a folder that is not there', async () => {
    const directory = await folder.directory();
    const params = { uid, instanceId: ours.instanceId };

    expect(await removeDiscoveryFile({ directory, ...params })).toEqual({
      status: 'left',
      reason: 'absent',
    });
    expect(
      await removeDiscoveryFile({ directory: path.join(directory, 'nowhere'), ...params }),
    ).toEqual({ status: 'left', reason: 'absent' });
  });

  it('sweeps the temp files of a crashed publish, and not those of a running process', async () => {
    const directory = await folder.directory();
    const running = tempFileName({ pid: process.pid, fill: '1' });
    const leftovers = [
      tempFileName({ pid: deadProcessId(), fill: '0' }),
      tempFileName({ pid: 0, fill: '2' }),
      running,
    ];

    for (const name of leftovers) {
      await plantFile({ file: path.join(directory, name), text: ours.token });
    }

    await publishDiscoveryFile({ directory, uid, value: successor });

    const result = await removeDiscoveryFile({ directory, uid, instanceId: ours.instanceId });

    expect(result.status).toBe('left');
    expect(await folder.names(directory)).toEqual(['server.json', running]);
  });

  it('sweeps the leftovers even when it removes its own file', async () => {
    const directory = await folder.directory();

    await publishDiscoveryFile({ directory, uid, value: ours });
    await plantFile({
      file: path.join(directory, tempFileName({ pid: 0, fill: '3' })),
      text: ours.token,
    });

    const result = await removeDiscoveryFile({ directory, uid, instanceId: ours.instanceId });

    expect(result.status).toBe('removed');
    expect(await folder.names(directory)).toEqual([]);
  });

  it('leaves a file it cannot read, which it cannot show to be its own', async () => {
    const directory = await folder.directory();

    await plantFile({ file: path.join(directory, 'server.json'), text: 'not json' });

    expect(await removeDiscoveryFile({ directory, uid, instanceId: ours.instanceId })).toEqual({
      status: 'left',
      reason: 'unreadable',
    });
    expect(await folder.names(directory)).toEqual(['server.json']);
  });
});
