import { createClient } from '@sheavly/client/client/client.helper';
import { fakeServer } from '@sheavly/client/testing/fake-server.fake';
import { modelIdSchema } from '@sheavly/protocol/model/model.validator';
import { profileIdSchema } from '@sheavly/protocol/profile/profile.validator';
import {
  putCredentialRequestSchema,
  putModelRequestSchema,
  putProfileRequestSchema,
  setDefaultProfileRequestSchema,
  bindWorkspaceRequestSchema,
} from '@sheavly/protocol/setup/setup.validator';
import type { AdapterDescription } from '@sheavly/protocol/model/model.types';
import type { Setup } from '@sheavly/protocol/setup/setup.types';
import type { SetupUi } from '../setup/setup.types.js';
import { terminalSettingsSchema } from '@sheavly/protocol/terminal-settings/terminal-settings.validator';

export function setupAdapter(): AdapterDescription {
  return {
    kind: 'setup-test',
    description: 'A provider described by the backend',
    secrets: ['password'],
    remoteField: 'deployment',
    config: {
      type: 'object',
      required: ['deployment', 'endpoint', 'limit', 'password'],
      properties: {
        deployment: { type: 'string', minLength: 1, title: 'Deployment' },
        endpoint: { type: 'string', format: 'uri', title: 'Endpoint' },
        limit: { type: 'integer', exclusiveMinimum: 0, title: 'Token limit' },
        reasoning: { type: 'boolean', default: true, title: 'Reasoning' },
        password: { type: 'string', secret: true, title: 'API key' },
      },
    },
  };
}

/** Stateful setup routes, validated by the same request and response schemas as the backend. */
export function fakeSetupBackend() {
  const state: Setup = { home: '/test-home', profiles: [], problems: [] };
  let binding: Setup['defaultProfile'];
  const profileOf = (id: string | undefined) => {
    const profile = state.profiles.find((item) => item.id === id);

    if (!profile) throw new Error(`Missing test profile ${id}`);

    return profile;
  };
  const modelOf = (profile: string | undefined, model: string | undefined) => {
    const found = profileOf(profile).models.find((item) => item.id === model);

    if (!found) throw new Error(`Missing test model ${model}`);

    return found;
  };
  const server = fakeServer({
    getSetup: () => state,
    setTerminalSettings: ({ body }) => {
      state.terminal = terminalSettingsSchema.parse(body);
    },
    migrateTerminalSettings: () => state.terminal ?? {},
    listAdapters: () => ({ adapters: [setupAdapter()] }),
    getProfile: ({ params }) => profileOf(params.profile),
    putProfile: ({ params, body }) => {
      const settings = putProfileRequestSchema.parse(body);
      const existing = state.profiles.find((item) => item.id === params.profile);

      if (existing) {
        Object.assign(existing, settings);

        return;
      }

      state.profiles.push({
        id: profileIdSchema.parse(params.profile),
        ...settings,
        ready: false,
        models: [],
      });
    },
    getModel: ({ params }) => modelOf(params.profile, params.model),
    putModel: ({ params, body }) => {
      const model = putModelRequestSchema.parse(body);
      const profile = profileOf(params.profile);
      const existing = profile.models.findIndex((item) => item.id === params.model);
      const next = {
        ...model,
        id: modelIdSchema.parse(params.model),
        credential: 'missing' as const,
        usable: false,
      };

      if (existing < 0) profile.models.push(next);
      else profile.models[existing] = next;
    },
    putCredential: ({ params, body }) => {
      putCredentialRequestSchema.parse(body);
      const model = modelOf(params.profile, params.model);

      model.credential = 'set';
      model.usable = true;
      profileOf(params.profile).ready = true;
    },
    checkCredential: () => ({ status: 'invalid', message: 'The key was refused.' }),
    setDefaultProfile: ({ body }) => {
      state.defaultProfile = setDefaultProfileRequestSchema.parse(body).profile;
    },
    bindWorkspace: ({ body }) => {
      binding = bindWorkspaceRequestSchema.parse(body).profile;
    },
    queryWorkspaceProfile: () => ({
      workspace: '/workspace',
      bound: binding !== undefined,
      ...((binding ?? state.defaultProfile) && { profile: binding ?? state.defaultProfile }),
    }),
  });
  const backend = {
    url: 'http://setup.test',
    token: 'test',
    fetch: server.fetch,
    stop: async () => undefined,
  };

  return { state, calls: server.calls, backend, client: createClient(backend), profileOf, modelOf };
}

/** Answers explicit questions; an unexpected question fails instead of silently accepting it. */
export function setupAnswers(answers: { text: string[]; choices: string[] }) {
  const questions: string[] = [];
  const notices: string[] = [];
  const secrets: string[] = [];
  const controller = new AbortController();
  const ui: SetupUi = {
    signal: controller.signal,
    text: async (question) => {
      questions.push(question.title);
      const value = answers.text.shift();

      if (value === undefined) throw new Error(`No answer for ${question.title}`);
      if (question.validate?.(value)) throw new Error(`Invalid test answer for ${question.title}`);
      if (question.secret) secrets.push(question.title);

      return value;
    },
    choose: async (question) => {
      questions.push(question.title);
      const value = answers.choices.shift();

      if (!question.items.some((item) => item.value === value)) {
        throw new Error(`No choice for ${question.title}`);
      }

      return value ?? '';
    },
    notice: (message) => {
      notices.push(message);
    },
  };

  return { ui, questions, notices, secrets, controller };
}
