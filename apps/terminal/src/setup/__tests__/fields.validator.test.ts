import { describe, expect, it } from 'vitest';
import { setupAdapter } from '../../testing/setup.fake.js';
import { fieldProblem, parseAdapterForm } from '../fields.validator.js';

describe('provider form validation', () => {
  it.each([
    ['limit', '0', true],
    ['limit', '1.5', true],
    ['limit', '2048', false],
    ['endpoint', 'not a URL', true],
    ['endpoint', 'https://azure.example/openai', false],
    ['deployment', '', true],
    ['deployment', 'my-deployment', false],
  ])('validates %s before submitting to the backend', (name, text, invalid) => {
    const field = parseAdapterForm(setupAdapter()).properties[name];

    expect(field).toBeDefined();
    if (!field) throw new Error('Missing test field');
    expect(fieldProblem({ field, required: true, text }) !== undefined).toBe(invalid);
  });

  it('allows an omitted optional field', () => {
    expect(
      fieldProblem({ field: { type: 'string', format: 'uri' }, required: false, text: '' }),
    ).toBeUndefined();
  });

  it('reports unsupported provider forms instead of omitting fields', () => {
    expect(() =>
      parseAdapterForm({
        ...setupAdapter(),
        config: { type: 'object', properties: { nested: { type: 'object' } } },
      }),
    ).toThrow('cannot display');
  });
});
