import { describe, expect, it } from 'vitest';
import { CODING_INSTRUCTIONS } from '@sheavly/coding/instructions/coding-instructions.constants';
import { BaseInstructionsConflictError } from '@sheavly/host/errors/system-prompt.errors';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import {
  SYSTEM_PROMPT_EXTEND_GRANT,
  SYSTEM_PROMPT_REPLACE_GRANT,
} from '@sheavly/extension/instructions/instructions.constants';
import { manifestOf } from '../../testing/manifest.fake.js';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { promptsOf } from '../../testing/prompt-run.fake.js';

const GUIDE = '# Notes guidance\nKeep notes short.';

/** An extension nothing in the harness knows about, contributing a section and/or a replacement. */
function guideExtension(params: { grants?: string[]; base?: string; name?: string }) {
  const { grants = [SYSTEM_PROMPT_EXTEND_GRANT], base, name = 'notes' } = params;

  return defineExtension({
    manifest: manifestOf({ name, instructions: ['notes'], grants }),
    activate: () => ({
      instructions: [{ name: 'notes', text: GUIDE }],
      ...(base !== undefined && { baseInstructions: base }),
    }),
  });
}

const open = useBackendRuns();

/** The prompts of the main session and its sub-agent on a run with these app options. */
const promptsWith = (app: Omit<Parameters<typeof open>[0], 'scripts' | 'onModelCall'>) =>
  promptsOf({ open: (scripted) => open({ ...app, ...scripted }) });

describe('a third-party extension’s system-prompt section, like coding’s own', () => {
  it('lands after the coding section and before the app’s extras, for the main session and a sub-agent', async () => {
    const { main, sub } = await promptsWith({
      extensions: [guideExtension({})],
      instructions: 'APP EXTRAS',
    });

    expect(main?.endsWith(`${CODING_INSTRUCTIONS}\n\n${GUIDE}\n\nAPP EXTRAS`)).toBe(true);
    expect(sub?.startsWith(`${main}\n\n# Sub-agent role\n`)).toBe(true);
    expect(sub?.split(GUIDE)).toHaveLength(2);
  });

  it('fails the run without the system-prompt:extend grant, naming it, and adds no section', async () => {
    await expect(open({ extensions: [guideExtension({ grants: [] })] })).rejects.toThrow(
      SYSTEM_PROMPT_EXTEND_GRANT,
    );
  });
});

describe('a third-party extension’s replacement of the generic base', () => {
  it('stands in for the generic base when the app passes none, before every section', async () => {
    const { main, sub } = await promptsWith({
      extensions: [
        guideExtension({
          grants: [SYSTEM_PROMPT_EXTEND_GRANT, SYSTEM_PROMPT_REPLACE_GRANT],
          base: '# Their base',
        }),
      ],
      instructions: 'APP EXTRAS',
    });

    expect(main).toBe(`# Their base\n\n${CODING_INSTRUCTIONS}\n\n${GUIDE}\n\nAPP EXTRAS`);
    expect(sub?.startsWith(`${main}\n\n# Sub-agent role\n`)).toBe(true);
    expect(main).not.toContain('# Git and GitHub');
  });

  it('is refused loudly, naming the extension, when the app passes its own baseInstructions', async () => {
    const replacer = guideExtension({
      grants: [SYSTEM_PROMPT_EXTEND_GRANT, SYSTEM_PROMPT_REPLACE_GRANT],
      base: '# Their base',
      name: 'replacer',
    });

    await expect(open({ extensions: [replacer], baseInstructions: 'APP BASE' })).rejects.toThrow(
      BaseInstructionsConflictError,
    );
    await expect(open({ extensions: [replacer], baseInstructions: 'APP BASE' })).rejects.toThrow(
      /Extension "replacer"/,
    );
  });

  it('fails the run without the system-prompt:replace grant', async () => {
    await expect(open({ extensions: [guideExtension({ base: '# Their base' })] })).rejects.toThrow(
      SYSTEM_PROMPT_REPLACE_GRANT,
    );
  });
});
