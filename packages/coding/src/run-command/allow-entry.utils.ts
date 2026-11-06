import { commandBase } from './command-base.utils.js';

/** A remembered grant covers every option and argument for this base command. */
export function suggestEntry(argv: readonly string[]): string | undefined {
  const base = commandBase(argv);

  if (base.length === 0) return undefined;
  const entry = `${base.join(' ')} *`;

  if (entry.length > 500 || base.some((word) => /\s/.test(word))) {
    return `exact:${JSON.stringify(base)}`;
  }

  return entry;
}
