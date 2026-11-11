import { describe, expect, it } from 'vitest';
import { runEnv } from '../run-env.utils.js';
import type { RunRequest } from '../workbook.types.js';

const request = (stored?: RunRequest['stored']): RunRequest => ({
  name: 'demo',
  text: 'Do it.',
  stored,
  keep: false,
  showModelCalls: false,
  trust: false,
});
const envFor = (stored?: RunRequest['stored']) =>
  runEnv({
    env: { KEEP: 'yes' },
    request: request(stored),
    workspaceRoot: '/work',
    modelCalls: '/runs/calls.jsonl',
    trustFile: undefined,
  });

describe('runEnv', () => {
  it('gives the backend the run’s workspace and files over the environment it was given', () => {
    expect(envFor()).toEqual({
      KEEP: 'yes',
      WORKSPACE_ROOT: '/work',
      MODEL_CALLS_FILE: '/runs/calls.jsonl',
      SHOW_MODEL_CALLS: 'false',
    });
  });

  it('turns a stored prompt’s maxTurns and contextWindow into the settings the backend reads', () => {
    const env = envFor({ name: 'demo', text: 'Do it.', maxTurns: 12, contextWindow: 40_000 });

    expect(env.MAX_TURNS).toBe('12');
    expect(env.CONTEXT_WINDOW).toBe('40000');
  });

  it('sets neither when the prompt asks for neither, so a model keeps its own window', () => {
    const env = envFor({ name: 'demo', text: 'Do it.' });

    expect(env).not.toHaveProperty('MAX_TURNS');
    expect(env).not.toHaveProperty('CONTEXT_WINDOW');
  });

  it('points the backend at a throwaway trust file when given one', () => {
    const env = runEnv({
      env: {},
      request: request(),
      workspaceRoot: '/work',
      modelCalls: '/runs/calls.jsonl',
      trustFile: '/tmp/trust.json',
    });

    expect(env.SHEAVLY_TRUST_FILE).toBe('/tmp/trust.json');
  });
});
