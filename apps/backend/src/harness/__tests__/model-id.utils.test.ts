import { describe, expect, it } from 'vitest';
import { modelIdOfEnvName, uuidV5 } from '../model-id.utils.js';

/** RFC 4122's DNS namespace. */
const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5', () => {
  it('matches the reference value for www.example.com in the DNS namespace', () => {
    expect(uuidV5({ namespace: DNS, name: 'www.example.com' })).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('modelIdOfEnvName', () => {
  it('makes a lowercase UUID version 5, the same for the same name every time', () => {
    const id = modelIdOfEnvName('gpt');

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(modelIdOfEnvName('gpt')).toBe(id);
  });

  it('tells names apart', () => {
    expect(modelIdOfEnvName('gpt')).not.toBe(modelIdOfEnvName('claude'));
  });
});
