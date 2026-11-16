import { describe, expect, it } from 'vitest';
import {
  credentialStateSchema,
  modelCatalogResponseSchema,
  profileSetupSchema,
  putCredentialRequestSchema,
  putModelRequestSchema,
  setupSchema,
  trustedWorkspaceSchema,
  workspaceRequestSchema,
} from '../setup.validator.js';

const PROFILE = '1a2b3c4d-5c0e-4a0e-9a53-8f7f4b1c2d3e';
const MODEL = '9d6c1a52-5c0e-4a0e-9a53-8f7f4b1c2d3e';
const SETUP_MODEL = {
  id: MODEL,
  name: 'Astra 6',
  adapter: 'openai',
  definition: { model: 'gpt-5' },
  credential: 'set',
  usable: true,
};
const PROFILE_SETUP = { id: PROFILE, name: 'Work', models: [SETUP_MODEL], ready: true };

describe('credentialStateSchema', () => {
  it('names only whether a secret is needed and set, never a value', () => {
    expect(credentialStateSchema.options).toEqual(['not_needed', 'missing', 'set']);
  });
});

describe('setupSchema', () => {
  it('reads a setup with a profile, its model and the problems found', () => {
    const setup = { home: '/home/me', profiles: [PROFILE_SETUP], problems: ['models/x.json'] };

    expect(setupSchema.parse(setup)).toEqual(setup);
  });

  it('requires every model of a profile to say its credential state and whether it is usable', () => {
    const { usable: _usable, ...incomplete } = SETUP_MODEL;

    expect(profileSetupSchema.safeParse({ ...PROFILE_SETUP, models: [incomplete] }).success).toBe(
      false,
    );
    expect(
      profileSetupSchema.safeParse({
        ...PROFILE_SETUP,
        models: [{ ...SETUP_MODEL, credential: 'unknown' }],
      }).success,
    ).toBe(false);
  });
});

describe('modelCatalogResponseSchema', () => {
  const offering = {
    name: 'Astra 6',
    identity: { model: 'astra-6' },
    hosts: [{ adapter: 'openai', name: 'OpenAI', defaults: {}, fixed: {} }],
  };

  it('lists a model with at least one way to host it', () => {
    expect(modelCatalogResponseSchema.parse({ models: [offering] })).toEqual({
      models: [offering],
    });
    expect(
      modelCatalogResponseSchema.safeParse({ models: [{ ...offering, hosts: [] }] }).success,
    ).toBe(false);
  });
});

describe('requests', () => {
  it('takes a model without its id, which the route names', () => {
    const body = { name: 'Astra 6', adapter: 'openai', definition: {} };

    expect(putModelRequestSchema.parse(body)).toEqual(body);
    expect(putModelRequestSchema.parse({ ...body, id: MODEL })).not.toHaveProperty('id');
  });

  it('takes secrets by field name and refuses an empty name or value', () => {
    expect(putCredentialRequestSchema.parse({ secrets: { apiKey: 'k' } })).toEqual({
      secrets: { apiKey: 'k' },
    });
    expect(putCredentialRequestSchema.safeParse({ secrets: { '': 'k' } }).success).toBe(false);
    expect(putCredentialRequestSchema.safeParse({ secrets: { apiKey: '' } }).success).toBe(false);
  });

  it('names a workspace by a non-empty path', () => {
    expect(workspaceRequestSchema.parse({ workspace: '/work' })).toEqual({ workspace: '/work' });
    expect(workspaceRequestSchema.safeParse({ workspace: '' }).success).toBe(false);
  });
});

describe('trustedWorkspaceSchema', () => {
  it.each(['trusted', 'changed', 'gone'])('accepts the state %s', (state) => {
    const workspace = { root: '/work', trustedAt: 5, state };

    expect(trustedWorkspaceSchema.parse(workspace)).toEqual(workspace);
  });

  it('rejects an unknown state', () => {
    expect(
      trustedWorkspaceSchema.safeParse({ root: '/w', trustedAt: 5, state: 'new' }).success,
    ).toBe(false);
  });
});
