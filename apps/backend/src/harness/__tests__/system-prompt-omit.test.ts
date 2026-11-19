import { describe, expect, it } from 'vitest';
import { CODING_INSTRUCTIONS } from '@sheavly/coding/instructions/coding-instructions.constants';
import {
  BaseInstructionsConflictError,
  UnknownInstructionSectionError,
} from '@sheavly/host/errors/system-prompt.errors';
import { composeInstructions } from '@sheavly/host/instructions/instructions.helper';
import { defineExtension } from '@sheavly/extension/extension/extension.utils';
import {
  BASE_INSTRUCTIONS_SECTION,
  SYSTEM_PROMPT_EXTEND_GRANT,
  SYSTEM_PROMPT_REPLACE_GRANT,
} from '@sheavly/extension/instructions/instructions.constants';
import type { ProviderRequest } from '@sheavly/core/provider/provider.types';
import type { Script } from '@sheavly/testing/provider/provider.types';
import { say, toolCall } from '@sheavly/testing/provider/routed-provider.fake';
import { useBackendRuns } from '../../testing/backend-run.fake.js';
import { manifestOf } from '../../testing/manifest.fake.js';
import { promptsOf } from '../../testing/prompt-run.fake.js';
import { sendPromptAndSettle } from '../../testing/send-prompt.fake.js';

const GUIDE = '# Notes guidance\nKeep notes short.';
const THEIR_BASE = '# Their base';

/** The generic base the host owns, written without the composer that applies `omit`. */
const GENERIC_BASE = composeInstructions({});

/** What the model is told: the given texts, each trimmed, blanks dropped, one blank line between. */
const told = (...texts: string[]) =>
  texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n');

/** An extension of the app's choosing: a `notes` section and, when asked, a replacement base. */
function notesExtension(params: { replaces?: boolean; onDeactivate?: () => void } = {}) {
  const { replaces = false, onDeactivate } = params;

  return defineExtension({
    manifest: manifestOf({
      name: 'notes',
      instructions: ['notes'],
      grants: replaces
        ? [SYSTEM_PROMPT_EXTEND_GRANT, SYSTEM_PROMPT_REPLACE_GRANT]
        : [SYSTEM_PROMPT_EXTEND_GRANT],
    }),
    activate: () => ({
      instructions: [{ name: 'notes', text: GUIDE }],
      ...(replaces && { baseInstructions: THEIR_BASE }),
    }),
    deactivate: () => onDeactivate?.(),
  });
}

const open = useBackendRuns();

type AppOptions = Parameters<typeof open>[0];

/** The main session's and a sub-agent's prompts for a run the app configures with `app`. */
function promptsWith(app: Omit<AppOptions, 'scripts' | 'onModelCall'>) {
  return promptsOf({ open: (recording) => open({ ...recording, ...app }) });
}

describe('an app that omits an instruction section never has its text in the prompt', () => {
  it.each([
    ['no app instructions', undefined],
    ['app instructions', '  APP EXTRAS\n'],
  ])(
    'tells the main session and a sub-agent the generic base without coding, with %s',
    async (_name, instructions) => {
      const { main, sub } = await promptsWith({
        extensions: [],
        instructions,
        omitInstructionSections: ['coding'],
      });

      expect(main).toBe(told(GENERIC_BASE, instructions ?? ''));
      expect(sub?.startsWith(`${main}\n\n# Sub-agent role\n`)).toBe(true);
      expect(sub).not.toContain(CODING_INSTRUCTIONS);
    },
  );

  it('gives a sub-agent started by a sub-agent the same base, without coding', async () => {
    const requests: ProviderRequest[] = [];
    const startHelper: Script = () => [
      toolCall({ id: 'm1', name: 'start_agent', input: { title: 'Helper', task: 'help' } }),
      { type: 'done', stopReason: 'tool_use' },
    ];
    const startDeep: Script = () => [
      toolCall({ id: 'm2', name: 'start_agent', input: { title: 'Deeper', task: 'deep' } }),
      { type: 'done', stopReason: 'tool_use' },
    ];
    const harness = await open({
      extensions: [],
      instructions: 'APP EXTRAS',
      omitInstructionSections: ['coding'],
      scripts: {
        go: [startHelper, say('done')],
        help: [startDeep, say('helped')],
        deep: [say('deeper')],
      },
      onModelCall: (request) => requests.push(request),
    });

    await sendPromptAndSettle({ harness, prompt: 'go' });

    const promptOf = (task: string) =>
      requests.find((request) => request.messages[0]?.content === task)?.instructions;
    const base = told(GENERIC_BASE, 'APP EXTRAS');

    expect(promptOf('go')).toBe(base);
    expect(promptOf('deep')?.startsWith(`${base}\n\n# Sub-agent role\n`)).toBe(true);
    expect(promptOf('deep')).not.toContain(CODING_INSTRUCTIONS);
  });

  it.each([
    [
      'a third-party section',
      ['notes'],
      told(GENERIC_BASE, CODING_INSTRUCTIONS, 'APP EXTRAS'),
      GUIDE,
    ],
    [
      'a built-in section',
      ['coding'],
      told(GENERIC_BASE, GUIDE, 'APP EXTRAS'),
      CODING_INSTRUCTIONS,
    ],
    ['both', ['coding', 'notes'], told(GENERIC_BASE, 'APP EXTRAS'), GUIDE],
  ])(
    'leaves out %s and keeps the rest in order, for the main session and a sub-agent',
    async (_name, omitted, expected, gone) => {
      const { main, sub } = await promptsWith({
        extensions: [notesExtension()],
        instructions: 'APP EXTRAS',
        omitInstructionSections: omitted,
      });

      expect(main).toBe(expected);
      expect(sub?.startsWith(`${main}\n\n# Sub-agent role\n`)).toBe(true);
      expect(sub).not.toContain(gone);
    },
  );

  it('keeps every section when the list is empty', async () => {
    const { main } = await promptsWith({
      extensions: [notesExtension()],
      omitInstructionSections: [],
    });

    expect(main).toBe(told(GENERIC_BASE, CODING_INSTRUCTIONS, GUIDE));
  });
});

describe('an app that omits a third-party replacement base', () => {
  it('runs with the app’s own baseInstructions instead of a conflict', async () => {
    const { main, sub } = await promptsWith({
      extensions: [notesExtension({ replaces: true })],
      baseInstructions: 'APP BASE',
      omitInstructionSections: [BASE_INSTRUCTIONS_SECTION],
    });

    expect(main).toBe(told('APP BASE', CODING_INSTRUCTIONS, GUIDE));
    expect(sub?.startsWith(`${main}\n\n# Sub-agent role\n`)).toBe(true);
    expect(main).not.toContain(THEIR_BASE);
  });

  it('uses the generic base when the app passes none', async () => {
    const { main } = await promptsWith({
      extensions: [notesExtension({ replaces: true })],
      omitInstructionSections: [BASE_INSTRUCTIONS_SECTION],
    });

    expect(main).toBe(told(GENERIC_BASE, CODING_INSTRUCTIONS, GUIDE));
  });
});

describe('an omitted name nothing contributed fails the run loudly', () => {
  it('rejects, naming the name and what is available', async () => {
    const failure = await open({ extensions: [], omitInstructionSections: ['codng'] }).catch(
      (caughtError: unknown) => caughtError,
    );

    expect(failure).toBeInstanceOf(UnknownInstructionSectionError);
    expect(failure).toMatchObject({ sectionName: 'codng', available: ['coding'] });
    expect((failure as Error).message).toContain('"codng"');
  });

  it('closes the extensions, like the conflict error does', async () => {
    let deactivated = 0;

    await expect(
      open({
        extensions: [notesExtension({ onDeactivate: () => (deactivated += 1) })],
        omitInstructionSections: ['missing'],
      }),
    ).rejects.toThrow(UnknownInstructionSectionError);
    expect(deactivated).toBe(1);
  });

  it.each([
    [
      'an unknown omitted name',
      UnknownInstructionSectionError,
      { extensions: [notesExtension()], omitInstructionSections: ['secret-typo'] },
    ],
    [
      'a replacement next to the app base',
      BaseInstructionsConflictError,
      { extensions: [notesExtension({ replaces: true })], baseInstructions: 'APP BASE' },
    ],
  ])(
    'throws the real error for %s, but the signal an extension holds does not carry the names',
    async (_what, errorClass, app) => {
      const signals: AbortSignal[] = [];
      const spy = defineExtension({
        manifest: manifestOf({ name: 'spy' }),
        activate: (context) => {
          signals.push(context.signal);

          return {};
        },
      });
      const failure = await open({ ...app, extensions: [spy, ...app.extensions] }).catch(
        (caughtError: unknown) => caughtError,
      );
      const reason = signals[0]?.reason as unknown;

      expect(failure).toBeInstanceOf(errorClass);
      expect(signals[0]?.aborted).toBe(true);
      expect(reason).toBeInstanceOf(Error);
      expect(reason).not.toBe(failure);
      expect(reason).toMatchObject({ name: 'SystemPromptFailedAbort' });

      const told = JSON.stringify([(reason as Error).message, (reason as Error).cause]);

      for (const name of ['secret-typo', 'notes', 'coding', 'baseInstructions', 'APP BASE']) {
        expect(told).not.toContain(name);
      }
    },
  );

  it('refuses the reserved name when no extension replaces the base', async () => {
    await expect(
      open({ extensions: [], omitInstructionSections: [BASE_INSTRUCTIONS_SECTION] }),
    ).rejects.toThrow(UnknownInstructionSectionError);
  });
});
