import { performance } from 'node:perf_hooks';

// Imported only by the test launcher: hook overlap cases must not depend on CI scheduling.
const now = Number(process.env.SHEAVLY_TEST_HOOK_NOW);

if (!Number.isSafeInteger(now)) throw new Error('Expected an integer test hook time.');

Object.defineProperties(performance, {
  timeOrigin: { value: now },
  now: { value: () => 0 },
});
