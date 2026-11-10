import { allowEntryBase } from '@sheavly/coding/run-command/command-base.utils';

function grantLabel(entry: string): string {
  const base = allowEntryBase(entry);

  if (base.length === 0) return `\`${entry}\``;

  const command = base
    .map((word) => (/^[\w./:@=-]+$/.test(word) ? word : JSON.stringify(word)))
    .join(' ');

  return `\`${command} *\``;
}

/** Labels describe effective base-command grants, not legacy path/option restrictions. */
export function keepsHint(params: {
  keeps: readonly string[];
  scope?: 'session' | 'workspace';
}): string {
  const { keeps, scope = 'workspace' } = params;
  // A grant is shared by the main session and every sub-agent, so the hint says so.
  const duration =
    scope === 'session'
      ? 'for every agent in this conversation, not saved'
      : 'in this folder, for every agent';

  return `keeps ${keeps.map(grantLabel).join(', ')} allowed ${duration}`;
}
