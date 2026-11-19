import { describe, expect, it } from 'vitest';
import { CODING_INSTRUCTIONS } from '@sheavly/coding/instructions/coding-instructions.constants';
import { composeInstructions } from '@sheavly/host/instructions/instructions.helper';
import { subAgentInstructions } from '@sheavly/tools/sub-agent/sub-agent.utils';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { promptsOf } from '../../testing/prompt-run.fake.js';

const open = useBackendRuns();

/** The generic base the host owns: what a harness with no extras and no extension says. */
const GENERIC_BASE = composeInstructions({});

/**
 * What the model was told before the coding guidance became an extension's section: the base (the
 * app's, or the generic one), the coding guidance, then the app's extras, each trimmed, blanks
 * dropped, one blank line between. Written out here, not taken from the code under test.
 */
function toldBefore(params: { base: string; extras?: string }): string {
  const { base, extras = '' } = params;

  return [base, CODING_INSTRUCTIONS, extras]
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** The prompts of the main session and its sub-agent on a run with only the built-in extensions. */
const promptsWith = (app: { instructions?: string; baseInstructions?: string }) =>
  promptsOf({ open: (scripted) => open({ extensions: [], ...app, ...scripted }) });

describe('the backend run’s system prompt is composed from the extensions’ contributions', () => {
  it('starts from the generic base the host owns, not an empty one', () => {
    expect(GENERIC_BASE.startsWith("Complete the user's task")).toBe(true);
    expect(GENERIC_BASE).toContain('# Git and GitHub');
  });

  it('exposes `instructions` as a getter that reads the host’s live text, not a copy', async () => {
    const { harness } = await promptsWith({ instructions: 'APP EXTRAS' });
    const descriptor = Object.getOwnPropertyDescriptor(harness, 'instructions');

    expect(descriptor).toHaveProperty('get');
    expect(descriptor).not.toHaveProperty('value');
    expect(harness.instructions).toBe(harness.systemPrompt.text);
    expect(harness.instructions).toContain(CODING_INSTRUCTIONS);
  });

  it.each([
    ['no app instructions', {}, toldBefore({ base: GENERIC_BASE })],
    [
      'app instructions',
      { instructions: '  APP EXTRAS\n' },
      toldBefore({ base: GENERIC_BASE, extras: 'APP EXTRAS' }),
    ],
    [
      'an app base',
      { baseInstructions: 'APP BASE', instructions: 'APP EXTRAS' },
      toldBefore({ base: 'APP BASE', extras: 'APP EXTRAS' }),
    ],
    ['an empty app base', { baseInstructions: '' }, toldBefore({ base: '' })],
  ])(
    'tells the main session byte for byte what it was told before, with %s',
    async (_name, options, expected) => {
      const { main, harness } = await promptsWith(options);

      expect(main).toBe(expected);
      expect(harness.instructions).toBe(expected);
    },
  );

  it.each([
    ['no app instructions', {}, toldBefore({ base: GENERIC_BASE })],
    [
      'app instructions',
      { instructions: '  APP EXTRAS\n' },
      toldBefore({ base: GENERIC_BASE, extras: 'APP EXTRAS' }),
    ],
    [
      'an app base and instructions',
      { baseInstructions: 'APP BASE', instructions: 'APP EXTRAS' },
      toldBefore({ base: 'APP BASE', extras: 'APP EXTRAS' }),
    ],
  ])(
    'gives a sub-agent exactly the old composition: the main text as its base, then its role rules, with %s',
    async (_name, options, expected) => {
      const { main, sub } = await promptsWith(options);
      // The role rules are an internal prompt of the tools package: read from a run with no app
      // text, so every case below is held to the same rules as well as to its base.
      const rules = (await promptsWith({})).sub?.split(
        `${toldBefore({ base: GENERIC_BASE })}\n\n`,
      )[1];

      expect(rules?.startsWith('# Sub-agent role\n')).toBe(true);
      expect(main).toBe(expected);
      expect(sub).toBe(subAgentInstructions({ base: expected, rules: rules ?? '' }));
      expect(sub?.split(CODING_INSTRUCTIONS)).toHaveLength(2);
      expect(sub?.split('# Sub-agent role')).toHaveLength(2);
    },
  );
});
