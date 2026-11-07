import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import type { ProfileSetup } from '@sheavly/protocol/setup/setup.types';
import { fakeSetupBackend, setupAnswers } from '../../testing/setup.fake.js';
import { runSetupWizard } from '../wizard.helper.js';
import { prepareSetup } from '../setup.helper.js';

const profile = profileIdSchema.parse('11111111-1111-4111-8111-111111111111');
const model = modelIdSchema.parse('22222222-2222-4222-8222-222222222222');

function readyWorkProfile(): ProfileSetup {
  return {
    id: profile,
    name: 'Work',
    ready: true,
    models: [
      {
        id: model,
        name: 'Selected',
        adapter: 'setup-test',
        definition: {},
        credential: 'set',
        usable: true,
      },
    ],
  };
}

describe('terminal setup over the API', () => {
  it('changes global terminal settings before profile selection without touching profiles or models', async () => {
    const backend = fakeSetupBackend();

    backend.state.profiles.push(readyWorkProfile());
    backend.state.terminal = { reducedMotion: true };
    const { ui } = setupAnswers({
      choices: [
        'terminal-settings',
        'animated',
        'on',
        'terminal-settings',
        'reduced',
        'off',
        profile,
        model,
        'start',
      ],
      text: [],
    });
    const initialChoices: (string | undefined)[] = [];
    const choose = ui.choose;

    ui.choose = (question) => {
      if (question.title === 'Terminal motion' || question.title === 'Terminal bell') {
        initialChoices.push(question.initial);
      }

      return choose(question);
    };

    await runSetupWizard({ ...backend, ui, workspace: '/workspace', setup: backend.state });

    expect(initialChoices).toEqual(['reduced', 'off', 'animated', 'on']);
    expect(backend.state.terminal).toEqual({ reducedMotion: true, bell: false });
    expect(backend.profileOf(profile).terminal).toBeUndefined();
    expect(
      backend.calls.filter(({ name }) => name.startsWith('put')).map(({ name }) => name),
    ).toEqual([]);
    expect(backend.calls.find(({ name }) => name === 'setTerminalSettings')).toMatchObject({
      call: { body: { reducedMotion: false, bell: true } },
    });
  });

  it('creates an ID-keyed profile and model, sends a masked key separately, binds and makes it default', async () => {
    const backend = fakeSetupBackend();
    const { ui, secrets, notices } = setupAnswers({
      choices: [
        'terminal-settings',
        'reduced',
        'off',
        'new',
        'new',
        'custom',
        'setup-test',
        'start',
      ],
      text: [
        'Work',
        'remote-deployment',
        'remote-deployment',
        'https://example.test',
        '2048',
        'private-key',
      ],
    });
    const id = await runSetupWizard({
      ...backend,
      ui,
      workspace: '/workspace',
      setup: backend.state,
    });
    const saved = backend.state.profiles[0];

    expect(saved?.models).toEqual([
      {
        id,
        name: 'remote-deployment',
        identity: { model: 'remote-deployment' },
        adapter: 'setup-test',
        credential: 'set',
        usable: true,
        definition: {
          deployment: 'remote-deployment',
          endpoint: 'https://example.test',
          limit: 2048,
          reasoning: true,
        },
      },
    ]);
    expect(backend.state.defaultProfile).toBe(saved?.id);
    expect(backend.state.terminal).toEqual({ reducedMotion: true, bell: false });
    expect(secrets).toEqual(['API key']);
    expect(JSON.stringify(backend.state)).not.toContain('private-key');
    expect(notices.join('\n')).not.toContain('private-key');
    expect(backend.calls.filter(({ name }) => name === 'putCredential')).toMatchObject([
      { call: { body: { secrets: { password: 'private-key' } } } },
    ]);
    expect(backend.calls.map(({ name }) => name)).not.toContain('checkCredential');
    expect(backend.calls.at(-2)).toMatchObject({
      name: 'bindWorkspace',
      call: { body: { workspace: '/workspace', profile: saved?.id } },
    });
  });

  it('uses an existing model without rewriting it or its key, and leaves an existing default alone', async () => {
    const backend = fakeSetupBackend();

    backend.state.defaultProfile = profileIdSchema.parse('33333333-3333-4333-8333-333333333333');
    backend.state.profiles.push(readyWorkProfile());
    const { ui } = setupAnswers({ choices: [profile, model, 'start'], text: [] });

    await expect(
      runSetupWizard({ ...backend, ui, workspace: '/workspace', setup: backend.state }),
    ).resolves.toBe(model);
    expect(
      backend.calls.filter(({ name }) => name.startsWith('put') || name === 'setDefaultProfile'),
    ).toEqual([]);
    expect(backend.calls.at(-1)?.name).toBe('bindWorkspace');
  });

  it('repairs missing credentials and lets a failed connection check return to key entry', async () => {
    const backend = fakeSetupBackend();

    backend.state.profiles.push({
      id: profile,
      name: 'Work',
      ready: false,
      models: [
        {
          id: model,
          name: 'Needs key',
          adapter: 'setup-test',
          definition: {},
          credential: 'missing',
          usable: false,
        },
      ],
    });
    const { ui, notices } = setupAnswers({
      choices: [profile, model, 'key', 'check', 'key', 'start'],
      text: ['bad-key', 'replacement-key'],
    });

    await runSetupWizard({ ...backend, ui, workspace: '/workspace', setup: backend.state });
    expect(notices).toContain('The key was refused.');
    expect(backend.calls.filter(({ name }) => name === 'putCredential')).toHaveLength(2);
    expect(backend.calls.filter(({ name }) => name === 'putModel')).toHaveLength(0);
  });

  it('does not prompt or write for a ready workspace in plain mode', async () => {
    const backend = fakeSetupBackend();

    backend.state.defaultProfile = profile;
    backend.state.profiles.push({ id: profile, name: 'Ready', ready: true, models: [] });
    await expect(
      prepareSetup({
        backend: backend.backend,
        workspace: '/workspace',
        interactive: false,
        force: false,
      }),
    ).resolves.toBeUndefined();
    expect(backend.calls.map(({ name }) => name).sort()).toEqual([
      'getSetup',
      'queryWorkspaceProfile',
    ]);
  });

  it('explains how to set up without consuming piped prompts', async () => {
    const backend = fakeSetupBackend();

    await expect(
      prepareSetup({
        backend: backend.backend,
        workspace: '/workspace',
        interactive: false,
        force: false,
      }),
    ).rejects.toThrow('interactive terminal');
    expect(backend.calls).toHaveLength(2);
  });
});
