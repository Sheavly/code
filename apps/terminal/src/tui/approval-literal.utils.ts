import { visibleControl } from '../render/terminal-text.utils.js';

/** Controls are visible, not executed or silently deleted. Backslashes are escaped to avoid ambiguity. */
export function approvalLiteral(text: string): string {
  return text.replace(/\\|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, visibleControl);
}
