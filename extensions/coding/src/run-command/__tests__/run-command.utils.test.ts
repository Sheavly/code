import { describe, expect, it } from 'vitest';
import { safeSteps } from '../run-command.utils.js';
import type { ScriptParams } from '@sheavly/workspace/process/process.types';

describe('command arguments after approval', () => {
  it('does not change grep paths, filters or unknown options and preserves connectors', () => {
    const steps: ScriptParams['steps'] = [
      { argv: ['grep', '-rn', 'A', '.env'], joinedBy: '|' },
      { argv: ['head', '-n', '3'], joinedBy: '&&' },
      { argv: ['grep', '--any-option', 'B', '..'] },
    ];

    expect(safeSteps(steps)).toEqual(steps);
  });

  it('retains Git driver protections without filtering user file operands', () => {
    expect(safeSteps([{ argv: ['git', 'diff', '--', '.env'] }])).toEqual([
      { argv: ['git', 'diff', '--no-ext-diff', '--no-textconv', '--', '.env'] },
    ]);
  });
});
