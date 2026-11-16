import { describe, expect, it } from 'vitest';
import { modelIdSchema } from '../../model/model.validator.js';
import { profileIdSchema, profileSchema } from '../profile.validator.js';

const ID = '9d2c7e10-6a4b-4f38-b1e5-5c0a8d3f2b71';

describe('profileIdSchema', () => {
  it('takes a lowercase UUID, and refuses capitals and anything that could name another path', () => {
    expect(profileIdSchema.parse(ID)).toBe(ID);

    for (const bad of [ID.toUpperCase(), 'work', '../work', `${ID}/..`, '']) {
      expect(profileIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('is the same shape as a model id but a different type, so neither is passed for the other', () => {
    // Same text, parsed by each: both accept it. The brands keep them apart at compile time.
    expect(modelIdSchema.parse(ID)).toBe(profileIdSchema.parse(ID));
  });
});

describe('profileSchema', () => {
  it('holds no fields beyond id, name, lastModelSelection and modelModes', () => {
    const parsed = profileSchema.parse({ id: ID, name: 'Work', terminal: { reducedMotion: true } });

    expect(parsed).toEqual({ id: ID, name: 'Work' });
  });

  it('holds a selection and per-model modes, rejecting unknown modes and non-ID keys', () => {
    const valid = {
      id: ID,
      name: 'Work',
      lastModelSelection: { modelId: ID, mode: 'high' },
      modelModes: { [ID]: 'high' },
    };

    expect(profileSchema.safeParse(valid).success).toBe(true);
    expect(profileSchema.safeParse({ ...valid, modelModes: { [ID]: 'turbo' } }).success).toBe(
      false,
    );
    expect(profileSchema.safeParse({ ...valid, modelModes: { Sonnet: 'high' } }).success).toBe(
      false,
    );
  });
  it('holds an id and the name a person gave it', () => {
    expect(profileSchema.parse({ id: ID, name: 'Work' })).toEqual({ id: ID, name: 'Work' });
  });

  it('trims the name, and refuses one with nothing in it or too long to show', () => {
    expect(profileSchema.parse({ id: ID, name: '  Work  ' }).name).toBe('Work');
    expect(profileSchema.safeParse({ id: ID, name: '   ' }).success).toBe(false);
    expect(profileSchema.safeParse({ id: ID, name: 'x'.repeat(81) }).success).toBe(false);
    expect(profileSchema.safeParse({ id: ID }).success).toBe(false);
  });

  it('lets two profiles share a name: it is a label, never a key', () => {
    const other = '00000000-0000-4000-8000-000000000001';

    expect(profileSchema.parse({ id: other, name: 'Work' }).name).toBe(
      profileSchema.parse({ id: ID, name: 'Work' }).name,
    );
  });
});
