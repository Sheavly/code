import { EXTENSION_TRANSITIONS } from './extension-state.constants.js';
import type { ExtensionState } from './extension-state.types.js';

/** Whether the table lets an extension in `from` move to `to`. */
export function canMove(params: { from: ExtensionState; to: ExtensionState }): boolean {
  const allowed: readonly ExtensionState[] = EXTENSION_TRANSITIONS[params.from];

  return allowed.includes(params.to);
}

/** Whether `state` is final: nothing moves out of it, and cleanup has run on the way in. */
export function isFinalState(state: ExtensionState): boolean {
  return EXTENSION_TRANSITIONS[state].length === 0;
}

/**
 * The table as the Markdown `docs/lifecycle.md` prints between its `extension-lifecycle` markers,
 * one row per state. A test fails when the printed block differs.
 */
export function extensionLifecycleMarkdown(): string {
  const rows = Object.entries(EXTENSION_TRANSITIONS).map(([state, next]) => {
    const to = next.length === 0 ? 'final' : next.join(', ');

    return `| \`${state}\` | ${to} |`;
  });

  return ['| State | May move to |', '| --- | --- |', ...rows].join('\n');
}
