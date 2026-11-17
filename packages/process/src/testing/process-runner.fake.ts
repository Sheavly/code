import { ProcessRunner } from '../process/process.service.js';

/** Test-only: a runner built from the test's own environment, as an app builds one from its own. */
export function testProcesses(): ProcessRunner {
  return new ProcessRunner({ env: process.env });
}
