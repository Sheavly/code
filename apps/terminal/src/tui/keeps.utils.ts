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
  const duration = scope === 'session' ? 'for this session only; not saved' : 'in this folder';

  return `keeps ${keeps.map(grantLabel).join(', ')} allowed ${duration}`;
}
