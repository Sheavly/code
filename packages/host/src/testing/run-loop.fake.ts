import type { RunLoop } from '../run-services/run-services.types.js';

/**
 * Test-only: the loop runner for a test that never runs a sub-agent. It fails if one is run, so a
 * test that does need the loop passes the real `runSession`.
 */
export const noSubAgentRuns: RunLoop = () =>
  Promise.reject(new Error('This test supplied no loop: it cannot run a sub-agent'));
