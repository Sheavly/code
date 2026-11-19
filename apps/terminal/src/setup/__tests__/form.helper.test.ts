import { describe, expect, it } from 'vitest';
import { setupAdapter, setupAnswers } from '../../testing/setup.fake.js';
import { askContextWindow, askDefinition } from '../form.helper.js';

/** What the picker showed for a model of size `current`, and the size it returned for `picked`. */
async function pickSize(params: { current: number | undefined; picked: string }) {
  const { ui } = setupAnswers({ choices: [params.picked], text: [] });
  const choose = ui.choose;
  let shown: { labels: string[]; initial: string | undefined } | undefined;

  ui.choose = (question) => {
    shown = { labels: question.items.map((item) => item.label), initial: question.initial };

    return choose(question);
  };

  return { size: await askContextWindow({ ui, current: params.current }), shown };
}

describe('askContextWindow', () => {
  it.each([
    { current: undefined, initial: '300000', labels: ['300K', '1M'] },
    { current: 300_000, initial: '300000', labels: ['300K', '1M'] },
    { current: 1_000_000, initial: '1000000', labels: ['300K', '1M'] },
    // A size the UI doesn't offer is shown by its exact count, first, and starts selected.
    { current: 128_000, initial: '128000', labels: ['128,000 tokens', '300K', '1M'] },
  ])('shows $labels and starts on $initial for a model of size $current', async (row) => {
    const { shown } = await pickSize({ current: row.current, picked: '300000' });

    expect(shown).toEqual({ labels: row.labels, initial: row.initial });
  });

  it('returns the size picked, as a number, including a model’s own', async () => {
    expect((await pickSize({ current: undefined, picked: '1000000' })).size).toBe(1_000_000);
    expect((await pickSize({ current: 128_000, picked: '128000' })).size).toBe(128_000);
  });

  it('refuses an answer that was not one of the sizes shown, without echoing it', async () => {
    const { ui } = setupAnswers({ choices: [], text: [] });

    ui.choose = async () => 'rm -rf /';

    await expect(askContextWindow({ ui, current: undefined })).rejects.toThrow(
      'That is not one of the sizes offered.',
    );
  });
});

describe('a default a preset supplies for a required field', () => {
  it('is asked, pre-filled, so a person accepts or changes it', async () => {
    const adapter = {
      ...setupAdapter(),
      config: {
        type: 'object',
        required: ['maxTokens'],
        properties: { maxTokens: { type: 'integer', title: 'Max tokens', minimum: 1 } },
      },
    };
    const { ui } = setupAnswers({ choices: [], text: [] });
    const shown: { title: string; initial: string | undefined }[] = [];

    ui.text = (question) => {
      shown.push({ title: question.title, initial: question.initial });

      return Promise.resolve(question.initial ?? '');
    };

    const accepted = await askDefinition({ adapter, ui, previous: { maxTokens: 32_000 } });

    expect(shown).toEqual([{ title: 'Max tokens', initial: '32000' }]);
    expect(accepted).toEqual({ maxTokens: 32_000 });

    ui.text = () => Promise.resolve('8000');

    expect(await askDefinition({ adapter, ui, previous: { maxTokens: 32_000 } })).toEqual({
      maxTokens: 8000,
    });
  });
});

describe('preset definition fields', () => {
  it.each([true, false])(
    'does not treat inherited object keys as fixed or previous values: %s',
    async (required) => {
      const adapter = {
        ...setupAdapter(),
        config: {
          type: 'object',
          required: required ? ['constructor'] : [],
          properties: { constructor: { type: 'string', title: 'Config label' } },
        },
      };
      const { ui, questions } = setupAnswers({ choices: [], text: required ? ['chosen'] : [] });
      const definition = await askDefinition({ adapter, ui, previous: {}, fixed: {} });

      expect(Object.hasOwn(definition, 'constructor')).toBe(required);
      expect(questions).toEqual(required ? ['Config label'] : []);

      if (required) expect(definition.constructor).toBe('chosen');
    },
  );
});
