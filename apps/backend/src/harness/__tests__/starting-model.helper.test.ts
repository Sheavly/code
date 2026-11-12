import { describe, expect, it } from 'vitest';
import { SetupError } from '../../errors/setup.errors.js';
import type { ModelSwitch } from '../harness.types.js';
import { startOnRequestedModel } from '../starting-model.helper.js';

const FAST = '4b1f9a52-3c5e-4a77-9d64-0e2b7f1c8a30';
const DEEP = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';
const FLASH = '00000000-0000-4000-8000-000000000003';

/** A switch over three models that records which one it was told to use. */
function models() {
  const used: string[] = [];
  const choice = (id: string, name: string, model: string) => ({
    id,
    name,
    adapter: 'openai',
    model,
  });
  const switchable = {
    choices: [
      choice(FAST, 'Astra', 'gpt-5-mini'),
      choice(DEEP, 'Opus', 'claude-opus'),
      choice(FLASH, 'DeepSeek Flash', 'DeepSeek-V4.1-Flash-1017'),
    ],
    switch: { use: (id: string) => used.push(id) },
  } as unknown as ModelSwitch;

  return { used, switchable };
}

const start = (requested: string) => {
  const { used, switchable } = models();

  startOnRequestedModel({ models: switchable, requested });

  return used;
};

describe('startOnRequestedModel', () => {
  it('takes an id, a name in any case, or a part of a name that only one model has', () => {
    expect(start(FLASH)).toEqual([FLASH]);
    expect(start('astra')).toEqual([FAST]);
    expect(start('deepseek')).toEqual([FLASH]);
  });

  it('takes a part of the model identity too, such as the deployment', () => {
    expect(start('claude')).toEqual([DEEP]);
    expect(start('1017')).toEqual([FLASH]);
  });

  it('prefers an exact name over a part of another name', () => {
    const { used, switchable } = models();

    switchable.choices.push({ id: 'x', name: 'Opus Mini', adapter: 'openai', model: 'm' } as never);
    startOnRequestedModel({ models: switchable, requested: 'opus' });

    expect(used).toEqual([DEEP]);
  });

  it('refuses a model that matches none, naming the ones the profile has', () => {
    const { used, switchable } = models();

    expect(() => startOnRequestedModel({ models: switchable, requested: 'gemini' })).toThrow(
      /matches none of.*Astra.*Opus.*DeepSeek Flash/,
    );
    expect(used).toEqual([]);
  });

  it('takes an uppercase id and ignores surrounding whitespace', () => {
    expect(start(` ${FLASH.toUpperCase()} `)).toEqual([FLASH]);
    expect(start('  astra  ')).toEqual([FAST]);
  });

  it('refuses an empty request, which would match every model, and says what it needs', () => {
    const { used, switchable } = models();

    for (const requested of ['', '   ']) {
      expect(() => startOnRequestedModel({ models: switchable, requested })).toThrow(
        /needs a name or an id.*Astra/,
      );
    }

    expect(used).toEqual([]);
  });

  it('refuses a guess between two models instead of running the wrong one', () => {
    const { used, switchable } = models();
    const attempt = () => startOnRequestedModel({ models: switchable, requested: 'e' });

    expect(attempt).toThrow(SetupError);
    expect(attempt).toThrow(/matches more than one/);
    expect(used).toEqual([]);
  });
});
