/** Test-only: polls until `check` is true (background tasks finish on their own schedule). */
export async function until(check: () => boolean, timeoutMs = 3_000) {
  // A monotonic timer, so a fixed or moved clock (`useFixedClock`) can't stretch the wait.
  const deadline = performance.now() + timeoutMs;

  while (!check()) {
    if (performance.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
