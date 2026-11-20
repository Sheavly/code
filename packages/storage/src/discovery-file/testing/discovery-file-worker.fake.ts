import { publishDiscoveryFile } from '../publish-discovery-file.helper.js';
import { ServerPresence } from '../server-presence.service.js';
import { sampleDiscoveryFile } from './discovery-file.fake.js';

/**
 * Test-only: forked as a child process by the discovery file tests, which hear it as IPC messages.
 * `argv`: `republish <directory> <times>` says `ready`, publishes the file that many times, each
 * with another pid, and says `done` with how many were published. `server <home> <token>` claims
 * the home, publishes a file with that token and its own pid, says how the claim went, and never
 * lets go (the test kills it).
 */
const [mode = '', directory = '', times = '0'] = process.argv.slice(2);

function say(event: Record<string, unknown>): void {
  process.send?.(event);
}

if (mode === 'republish') {
  say({ status: 'ready' });

  let published = 0;

  for (let round = 1; round <= Number(times); round += 1) {
    const result = await publishDiscoveryFile({
      directory,
      uid: process.getuid?.() ?? 0,
      value: sampleDiscoveryFile({
        pid: round,
        token: `${String(round)}-${sampleDiscoveryFile().token}`,
      }),
    });

    if (result.status === 'published') published += 1;
  }

  say({ status: 'done', published });
} else if (mode === 'server') {
  const presence = new ServerPresence({
    home: directory,
    env: {},
    uid: process.getuid?.() ?? 0,
    log: (message) => {
      say({ status: 'log', message });
    },
  });
  const claimed = await presence.claim();

  await presence.publish(sampleDiscoveryFile({ pid: process.pid, token: times }));
  say({ status: claimed.status });
  // Never lets go: the test kills it, as a crash would.
  await new Promise(() => undefined);
}
