// The one answer to "is this path a test or a fake", for lint rules and the development hooks.
// Fakes are told by folder: the file kinds keep them in `testing/` or `__tests__/`, and a
// workspace whose job is fakes (`packages/testing`) must not be taken for tests by file name.
const TEST_OR_FAKE = /(^|\/)(__tests__|testing)\/|\.test\.[cm]?[jt]sx?$/;

/**
 * Whether `file` is a test or fake: in a `__tests__/` or `testing/` folder, or named `*.test.*`.
 * Pass a path relative to a workspace's `src/`, not to the repo, when the workspace's own folder
 * may be called `testing` (`packages/testing`).
 */
export function isTestOrFake(file) {
  return TEST_OR_FAKE.test(file.split('\\').join('/'));
}
