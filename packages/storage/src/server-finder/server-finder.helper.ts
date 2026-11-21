import { readDiscoveryFile } from '../discovery-file/read-discovery-file.helper.js';
import { probeServerLock } from '../server-lock/server-lock-probe.helper.js';
import { serverRuntimeCandidates } from '../server-runtime/server-runtime.helper.js';
import type { RuntimeCandidate } from '../server-runtime/server-runtime.types.js';
import { askHandshake } from './server-finder-handshake.helper.js';
import type { FindRunningServerParams, FoundServer, Reason } from './server-finder.types.js';
import {
  noAnswerReason,
  readReason,
  readVerdict,
  safeLog,
  simpleReason,
} from './server-finder.utils.js';

type Mismatch = Extract<FoundServer, { status: 'version_mismatch' }>;
type Inspected = Exclude<FoundServer, { status: 'none' }> | { status: 'skipped'; reason: Reason };

/**
 * Finds the running server of `home` without being told its address or token: it looks in each
 * folder `serverRuntimeCandidates` lists, in order, reads the discovery file through the safe
 * reader, asks the lock whether a server really holds it, and only then calls `verify` (the
 * handshake, injected because a library may not depend on the client). The token is returned only
 * in `found`, after the handshake proved the server holds it; a stale file or a lock that did not
 * answer never reaches `verify` at all, and no message, log line or thrown error holds the token,
 * whatever `verify` answers or throws. A `verify` that does not settle in `timeoutMs` (5 s unless
 * set) is given up on and told so through its `signal`.
 * A `version_mismatch` is remembered while the next folder is tried, and
 * returned when none verified. It reads and probes only: it creates and changes nothing. Rejects
 * only when `home` cannot be resolved at all.
 */
export async function findRunningServer(params: FindRunningServerParams): Promise<FoundServer> {
  const { home, env, platform = process.platform, log } = params;
  const candidates = await serverRuntimeCandidates({ env, home, platform });
  const reasons: Reason[] = [];
  let mismatch: Mismatch | undefined;

  for (const candidate of candidates) {
    const inspected = await inspect({ candidate, params: { ...params, platform } });

    if (inspected.status === 'found') return inspected;

    if (inspected.status === 'version_mismatch') {
      mismatch ??= inspected;
    } else {
      reasons.push(inspected.reason);
      safeLog({ log, line: inspected.reason.message });
    }
  }

  return mismatch ?? { status: 'none', reasons };
}

async function inspect(params: {
  candidate: RuntimeCandidate;
  params: FindRunningServerParams & { platform: NodeJS.Platform };
}): Promise<Inspected> {
  const { directory } = params.candidate;
  const { home, uid, platform, verify, timeoutMs } = params.params;
  const read = await readDiscoveryFile({ directory, uid, platform });

  if (read.status !== 'found') return skipped(readReason({ directory, read }));

  const lock = await probeServerLock({
    runtimeDir: directory,
    home,
    platform,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });

  if (lock === 'free') return skipped(simpleReason({ directory, problem: 'stale' }));

  if (lock === 'inconclusive') {
    return skipped(simpleReason({ directory, problem: 'lock-inconclusive' }));
  }

  const { url, token, instanceId, pid, serverVersion } = read.value;
  let answer: unknown;

  try {
    answer = await askHandshake({
      verify,
      ask: { url, token, instanceId, ...(timeoutMs !== undefined && { timeoutMs }) },
    });
  } catch (caughtError) {
    // Whatever the handshake threw (a timeout, a network error) is reduced to its kind: its text
    // could quote the address or the token, and the caller needs only that there was no answer.
    return skipped(noAnswerReason({ directory, failure: caughtError }));
  }

  // An answer that is none of the four shapes is as good as no handshake at all.
  const verdict = readVerdict({ value: answer, token }) ?? { status: 'no_handshake' as const };

  if (verdict.status === 'verified') {
    return {
      status: 'found',
      url,
      token,
      instanceId,
      pid,
      serverVersion,
      protocolVersion: verdict.protocolVersion,
    };
  }

  if (verdict.status === 'version_mismatch') {
    const { older, client, server, message } = verdict;

    return { status: 'version_mismatch', older, client, server, message };
  }

  const problem = verdict.status === 'wrong_server' ? 'wrong-server' : 'no-handshake';

  return skipped(simpleReason({ directory, problem }));
}

function skipped(reason: Reason): Inspected {
  return { status: 'skipped', reason };
}
