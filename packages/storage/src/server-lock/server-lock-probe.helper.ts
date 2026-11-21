import { serverNameHash } from '../server-runtime/server-runtime.helper.js';
import { serverEndpoint } from '../server-runtime/server-runtime.utils.js';
import { PROBE_TIMEOUT_MS } from './server-lock.constants.js';
import type { LockProbe } from './server-lock.types.js';
import { probeSocket } from './server-socket.helper.js';

/**
 * Whether a server of `home` holds its lock, by connecting to the lock socket in `runtimeDir`
 * (`timeoutMs` to answer, `PROBE_TIMEOUT_MS` when unset): accepted is `held`, refused or missing
 * is `free`, a timeout or any other error is `inconclusive`. It only connects: it never listens,
 * unlinks or changes anything, so it is safe on a live server's socket. Rejects when the home
 * cannot be resolved at all, as `serverNameHash` does. The Windows named-pipe branch is written
 * but not tested.
 */
export async function probeServerLock(params: {
  runtimeDir: string;
  home: string;
  platform: NodeJS.Platform;
  timeoutMs?: number;
}): Promise<LockProbe> {
  const { runtimeDir, home, platform, timeoutMs = PROBE_TIMEOUT_MS } = params;
  const hash = await serverNameHash({ home });

  const probe = await probeSocket({
    path: serverEndpoint({ platform, runtimeDir, hash }),
    timeoutMs,
  });

  if (probe === 'live') return 'held';

  return probe === 'stale' ? 'free' : 'inconclusive';
}
