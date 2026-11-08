import { describe, expect, it } from 'vitest';
import { SUB_AGENT_INSTRUCTIONS } from '../sub-agent.constants.js';
import { subAgentInstructions } from '../sub-agent.utils.js';

describe('child instruction assembly', () => {
  it('keeps the child role small and retains status and parent steering', () => {
    expect(SUB_AGENT_INSTRUCTIONS.trim().split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(SUB_AGENT_INSTRUCTIONS).toContain('report_status before starting');
    expect(SUB_AGENT_INSTRUCTIONS).toContain('Incorporate parent messages');
  });

  it('puts shared text before the role and child extras last', () => {
    expect(
      subAgentInstructions({ base: 'SHARED', rules: SUB_AGENT_INSTRUCTIONS, extra: 'CHILD' }),
    ).toBe(`SHARED\n\n${SUB_AGENT_INSTRUCTIONS}\n\nCHILD`);
  });

  it('keeps the child role without an injected base or with empty extras', () => {
    expect(subAgentInstructions({ rules: SUB_AGENT_INSTRUCTIONS })).toBe(SUB_AGENT_INSTRUCTIONS);
    expect(subAgentInstructions({ base: '', rules: SUB_AGENT_INSTRUCTIONS, extra: ' \n ' })).toBe(
      SUB_AGENT_INSTRUCTIONS,
    );
  });
});
