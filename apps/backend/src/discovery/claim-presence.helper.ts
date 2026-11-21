import { ServerPresence } from '@sheavly/storage/discovery-file/server-presence.service';
import { describeHeld } from '@sheavly/storage/discovery-file/server-presence.utils';
import type { PresenceStart } from './discovery.types.js';

/**
 * Takes the lock of `home` for a discoverable server once its settings are checked and its backend
 * is built, and before it listens, writes or prints anything, so a refused start has changed
 * nothing but its own lock probe (no HTTP listen, no file written, nothing printed but the
 * refusal). A server that is not discoverable builds no presence at all: no lock, no folder, no
 * file. `log` takes raw text; warnings get their line break here.
 */
export async function claimServerPresence(params: {
  discoverable: boolean;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  uid: number;
  log: (text: string) => void;
}): Promise<PresenceStart> {
  const { discoverable, home, env, uid, log } = params;

  if (!discoverable) return { status: 'go', presence: undefined };

  const presence = new ServerPresence({ home, env, uid, log: (text) => log(`${text}\n`) });
  const claim = await presence.claim();

  if (claim.status === 'held') {
    return { status: 'refused', message: describeHeld({ path: claim.path, first: claim.first }) };
  }

  return { status: 'go', presence };
}
