import { fork } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDiscoveryFile } from '../read-discovery-file.helper.js';
import { useDiscoveryFolder } from '../testing/discovery-file.fake.js';

const folder = useDiscoveryFolder();
const WORKER = path.join(import.meta.dirname, '..', 'testing', 'discovery-file-worker.fake.ts');
const REPUBLISHES = 200;

describe('a reader beside a server that republishes the file', () => {
  it('only ever sees a complete valid file or none', async () => {
    const directory = await folder.directory();
    const child = fork(WORKER, ['republish', directory, String(REPUBLISHES)], {
      execArgv: ['--conditions=@sheavly/source', '--import', 'tsx'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let finished: { published: number } | undefined;

    child.on('message', (event: { status: string; published?: number }) => {
      if (event.status === 'done') finished = { published: event.published ?? 0 };
    });

    const other: string[] = [];
    const seen = { found: 0, none: 0, other };

    try {
      while (finished === undefined) {
        const result = await readDiscoveryFile({ directory, uid: folder.uid });

        if (result.status === 'found') {
          seen.found += 1;
          expect(result.value.token).toMatch(/^\d+-k3Y9-/);
        } else if (result.status === 'none') {
          seen.none += 1;
        } else {
          seen.other.push(result.status);
        }
      }
    } finally {
      child.kill('SIGKILL');
    }

    expect(finished.published).toBe(REPUBLISHES);
    expect(seen.other).toEqual([]);
    expect(seen.found).toBeGreaterThan(0);
    expect(await folder.names(directory)).toEqual(['server.json']);
  }, 60_000);
});
