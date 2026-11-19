import type { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
/**
 * The loop's runner for one nested session, which `child-sessions` calls from `runChild` with the
 * run's full registries. The app passes the loop's `runSession`: the extension never holds it.
 */
export type RunLoop = typeof runSession;
