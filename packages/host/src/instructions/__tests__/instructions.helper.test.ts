import { describe, expect, it } from 'vitest';
import { BASE_AGENT_INSTRUCTIONS } from '../instructions.constants.js';
import { composeInstructions } from '../instructions.helper.js';
import { createHarness } from '../../host/host.helper.js';
import { scriptedProvider } from '@sheavly/testing/provider/scripted-provider.fake';

describe('shared instructions', () => {
  it('uses a domain-neutral default without named tools or coding assumptions', () => {
    const harness = createHarness({ provider: scriptedProvider([]), title: 'Extract text' });

    expect(harness.instructions).toBe(BASE_AGENT_INSTRUCTIONS);
    expect(harness.instructions).not.toMatch(
      /coding agent|workspace|report_status|run_command|task_status/,
    );
    expect(harness.instructions.trim().split(/\s+/).length).toBeLessThanOrEqual(110);
    expect(harness.instructions).toContain('read-only, plan-only and no-execution limits');
    expect(harness.instructions).toContain("do not expand the user's authorization");
  });

  it('makes yielding rather than status polling part of the system instructions', () => {
    const instructions = composeInstructions({ instructions: 'Extract the result.' });

    expect(instructions).toContain(
      'end your turn without tool calls to wait for required background results',
    );
    expect(instructions).toContain(
      'Inspect status only for requested updates or diagnosis, never waiting',
    );
    expect(instructions.match(/end your turn without tool calls/g)).toHaveLength(1);
  });

  it('appends host extras once, separated by a blank line', () => {
    expect(composeInstructions({ instructions: '  HOST EXTRAS\n' })).toBe(
      `${BASE_AGENT_INSTRUCTIONS}\n\nHOST EXTRAS`,
    );
  });

  it('replaces the core without removing extras', () => {
    expect(composeInstructions({ baseInstructions: 'CUSTOM', instructions: 'EXTRAS' })).toBe(
      'CUSTOM\n\nEXTRAS',
    );
  });

  it('distinguishes an absent base from an explicitly empty one', () => {
    expect(composeInstructions({ baseInstructions: undefined })).toBe(BASE_AGENT_INSTRUCTIONS);
    expect(composeInstructions({ baseInstructions: '', instructions: 'EXTRAS' })).toBe('EXTRAS');
    expect(composeInstructions({ baseInstructions: '', instructions: ' \n ' })).toBe('');
  });
});
