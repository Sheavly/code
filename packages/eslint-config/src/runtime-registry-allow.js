// The files of `extensions/*` that may still value-import the runtime registries or `createHarness`
// (`harness/extension-no-runtime-registries`). Each entry names its file and why; a test fails when
// an entry no longer matches a violation, so the list can only shrink.

/** @type {readonly { file: string, reason: string }[]} */
export const RUNTIME_REGISTRY_ALLOW = [
  {
    file: 'extensions/coding/src/preset/coding.helper.ts',
    reason:
      'coding still builds its own harness with createHarness until it reads the scoped services; the coding layer removes this entry.',
  },
];
