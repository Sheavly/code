import { describe, expect, it } from 'vitest';
import { setupAdapter, setupAnswers } from '../../testing/setup.fake.js';
import { askDefinition } from '../form.helper.js';

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
