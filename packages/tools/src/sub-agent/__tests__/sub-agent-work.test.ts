import { describe, expect, it } from 'vitest';
import { subAgentWork } from '../sub-agent-work.utils.js';

describe('the sub-agent work kind', () => {
  it('is finite work, stated by the kind and not defaulted by the registry', () => {
    const work = subAgentWork({
      command: 'sub-agent: x',
      description: 'x',
      run: async () => ({ exitCode: 0 }),
    });

    expect(work.backgroundKind).toBe('task');
  });
});
