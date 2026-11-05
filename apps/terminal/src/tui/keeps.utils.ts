/**
 * What the "Always allow" choice says it does: the exact entries it would keep, in backticks, so
 * the user can inspect every permission being granted, including every entry in a command chain.
 */
export function keepsHint(keeps: readonly string[]): string {
  return `keeps ${keeps.map((entry) => `\`${entry}\``).join(', ')} allowed in this folder`;
}
