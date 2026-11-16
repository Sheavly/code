import { describe, expect, it } from 'vitest';
import { sessionIdSchema } from '@sheavly/protocol/session/session.validator';
import { subAgentWork } from '../sub-agent-work.utils.js';

describe('the sub-agent work kind', () => {
  it('is the agent kind (finite work named apart), stated and not defaulted by the registry', () => {
    const work = subAgentWork({
      command: 'sub-agent: x',
      description: 'x',
      sessionId: sessionIdSchema.parse('main'),
      run: async () => ({ exitCode: 0 }),
    });

    expect(work.backgroundKind).toBe('agent');
  });
});
