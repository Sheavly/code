/**
 * One system-instructions string from its parts (the run's own, then each hook's), separated by
 * blank lines; `undefined` when there is nothing, so providers send no instructions at all.
 */
export function joinInstructions(parts: (string | undefined)[]): string | undefined {
  const present = parts
    .map((part) => part?.trim())
    .filter((part) => part !== undefined && part !== '');

  return present.length > 0 ? present.join('\n\n') : undefined;
}
