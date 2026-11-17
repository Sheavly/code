/**
 * Wraps the app's `onExtensionProblem` so a callback that throws is not a second failure: it
 * could replace the error being reported or become an unhandled rejection. Only the kind of its
 * failure is warned, since its message could quote what an extension reported.
 */
export function safeProblemReporter(
  onProblem: ((caughtError: unknown) => void) | undefined,
): (caughtError: unknown) => void {
  return (caughtError) => {
    try {
      onProblem?.(caughtError);
    } catch (caughtError_) {
      const kind = caughtError_ instanceof Error ? caughtError_.name : 'unknown';

      process.emitWarning(`Reporting an extension problem failed (${kind}).`);
    }
  };
}
