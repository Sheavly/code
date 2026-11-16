/** A visible representation for one control character, including Unicode format controls. */
export function visibleControl(character: string): string {
  const escaped = JSON.stringify(character).slice(1, -1);

  if (escaped !== character) return escaped;

  return character
    .split('')
    .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .join('');
}

/**
 * What a caught failure says, as plain terminal text: its message (a backend's text is shown,
 * not obeyed), or the value as a string when it is not an Error. The one way a failure is printed.
 */
export function describeFailure(caughtError: unknown): string {
  return plainTerminalText(
    caughtError instanceof Error ? caughtError.message : String(caughtError),
  );
}

/** Escape untrusted text before adding terminal styles or links. Markdown newlines and tabs survive. */
export function plainTerminalText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === '\n' || character === '\t') return character;

    return visibleControl(character);
  });
}
