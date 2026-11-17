import { describe, expect, it } from 'vitest';
import { extensionManifestSchema } from '../manifest.validator.js';

/** The messages zod gives for `input`, or an empty list when it is a valid manifest. */
function problems(input: unknown): string[] {
  const parsed = extensionManifestSchema.safeParse(input);

  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The path of every problem, joined with dots, for asserting where the manifest is wrong. */
function problemPaths(input: unknown): string[] {
  const parsed = extensionManifestSchema.safeParse(input);

  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('the extension manifest schema', () => {
  it('accepts a manifest with only a name, and fills every other field with an empty default', () => {
    expect(extensionManifestSchema.parse({ name: 'notes' })).toEqual({
      name: 'notes',
      dependsOn: [],
      services: { requires: [], optional: [], provides: [] },
      settings: [],
      tools: [],
      hooks: [],
      workKinds: [],
      emits: { events: [], modelFacingNotices: false },
      serves: { actions: [] },
    });
  });

  it('accepts a full manifest, including the $schema that points an editor at the JSON Schema', () => {
    const full = {
      $schema: './sheavly.schema.json',
      name: 'notes',
      dependsOn: ['files'],
      services: { requires: ['sessions'], optional: ['outputs'], provides: ['notes-store'] },
      settings: [
        { name: 'notes.max', type: 'number', default: 50, description: 'How many to keep' },
        { name: 'notes.title', type: 'string', default: 'Notes', description: 'A title' },
        { name: 'notes.loud', type: 'boolean', default: false, description: 'Shout' },
      ],
      tools: ['add_note'],
      hooks: ['notes-hook'],
      workKinds: ['notes.sync'],
      emits: { events: ['notes.added'], modelFacingNotices: true },
      serves: { actions: ['notes.clear'] },
    };

    expect(extensionManifestSchema.parse(full)).toEqual(full);
  });

  it('requires a name', () => {
    expect(problemPaths({})).toEqual(['name']);
  });

  it.each([
    ['an unknown top-level key', { name: 'notes', depends: [] }],
    ['an unknown key in services', { name: 'notes', services: { need: [] } }],
    ['an unknown key in emits', { name: 'notes', emits: { event: [] } }],
    ['an unknown key in serves', { name: 'notes', serves: { action: [] } }],
    [
      'an unknown key in a setting',
      {
        name: 'notes',
        settings: [{ name: 'notes.a', type: 'number', default: 1, description: 'x', min: 0 }],
      },
    ],
  ])('rejects %s, so a typo does not silently declare nothing', (_what, input) => {
    expect(problems(input).join('\n')).toMatch(/Unrecognized key/);
  });

  it.each(['Notes', 'two words', 'under_score', '', '-lead', 'a.b'])(
    'rejects the name %j',
    (name) => {
      expect(problemPaths({ name })).toEqual(['name']);
    },
  );

  it('rejects wrong types: a string for a list, a number for a name', () => {
    expect(problemPaths({ name: 'notes', dependsOn: 'files' })).toEqual(['dependsOn']);
    expect(problemPaths({ name: 'notes', tools: [1] })).toEqual(['tools.0']);
    expect(problemPaths({ name: 7 })).toEqual(['name']);
  });

  it('rejects a dependency on itself and the same dependency twice', () => {
    expect(problems({ name: 'notes', dependsOn: ['notes'] })).toEqual([
      'an extension cannot depend on itself',
    ]);
    expect(problems({ name: 'notes', dependsOn: ['files', 'files'] })).toEqual([
      '"files" is listed twice',
    ]);
  });

  it('rejects a service listed twice, and one both required and optional', () => {
    expect(problems({ name: 'notes', services: { requires: ['a', 'a'] } })).toEqual([
      '"a" is listed twice',
    ]);
    expect(problems({ name: 'notes', services: { provides: ['a', 'a'] } })).toEqual([
      '"a" is listed twice',
    ]);
    expect(problems({ name: 'notes', services: { requires: ['a'], optional: ['a'] } })).toEqual([
      '"a" is already in requires',
    ]);
  });

  it.each(['tools', 'hooks', 'workKinds'])('rejects a name listed twice in %s', (field) => {
    expect(problemPaths({ name: 'notes', [field]: ['one', 'one'] })).toEqual([`${field}.1`]);
  });

  describe('wildcard names', () => {
    it('accepts a prefix wildcard in tools, hooks and workKinds, and a bare * in hooks', () => {
      expect(
        problems({
          name: 'notes',
          tools: ['notes_*'],
          hooks: ['project-hooks.*', 'other'],
          workKinds: ['notes.*'],
        }),
      ).toEqual([]);
      expect(problems({ name: 'notes', hooks: ['*'] })).toEqual([]);
    });

    it.each(['tools', 'workKinds'])(
      'rejects a bare * in %s: only hooks may match any name',
      (field) => {
        expect(problems({ name: 'notes', [field]: ['*'] })).toEqual([
          'a bare "*" is only allowed in hooks; give a prefix',
        ]);
      },
    );

    it.each(['a*b', '*a', 'a**', 'a*b*', '**', 'a.*.b'])(
      'rejects %j: a * is only valid once, at the end',
      (name) => {
        expect(problemPaths({ name: 'notes', hooks: [name] })).toEqual(['hooks.0']);
      },
    );

    it('rejects the same wildcard twice', () => {
      expect(problems({ name: 'notes', hooks: ['a*', 'a*'] })).toEqual(['"a*" is listed twice']);
    });
  });

  describe('service names', () => {
    const lists = ['requires', 'optional', 'provides'];

    it.each(lists.flatMap((list) => ['*', 'a*', '*a', 'a*b'].map((name) => [list, name])))(
      'rejects a wildcard in services.%s (%j): a service matches by exact name',
      (list, name) => {
        const input = { name: 'notes', services: { [list]: [name] } };

        expect(problemPaths(input)).toContain(`services.${list}.0`);
        expect(problems(input).join('\n')).toContain('cannot contain "*"');
      },
    );

    it.each(lists.flatMap((list) => ['Bad_Name', 'two words', 'a.b', ''].map((n) => [list, n])))(
      'rejects a service name that is not kebab-case in services.%s (%j)',
      (list, name) => {
        expect(problemPaths({ name: 'notes', services: { [list]: [name] } })).toContain(
          `services.${list}.0`,
        );
      },
    );

    it('accepts kebab-case service names', () => {
      expect(problems({ name: 'notes', services: { requires: ['sub-agents', 'tasks'] } })).toEqual(
        [],
      );
    });
  });

  describe('dependsOn', () => {
    it.each(['Not Kebab', '*', 'a*', 'a.b', 'under_score'])(
      'rejects the dependency %j: an extension name is kebab-case',
      (name) => {
        expect(problemPaths({ name: 'notes', dependsOn: [name] })).toEqual(['dependsOn.0']);
      },
    );
  });

  describe('limits', () => {
    it('accepts a name of 128 characters and rejects one of 129', () => {
      expect(problems({ name: 'a'.repeat(128) })).toEqual([]);
      expect(problemPaths({ name: 'a'.repeat(129) })).toEqual(['name']);
    });

    it.each([
      ['a tool name', { tools: ['t'.repeat(129)] }, 'tools.0'],
      ['a dependency', { dependsOn: ['d'.repeat(129)] }, 'dependsOn.0'],
      ['a service name', { services: { requires: ['s'.repeat(129)] } }, 'services.requires.0'],
    ])('rejects an over-long %s', (_what, fields, path) => {
      expect(problemPaths({ name: 'notes', ...fields })).toContain(path);
    });

    it.each(['tools', 'hooks', 'workKinds', 'dependsOn'])(
      'accepts 1000 entries in %s and rejects 1001',
      (field) => {
        const list = (size: number) => Array.from({ length: size }, (_, index) => `n${index}`);

        expect(problems({ name: 'notes', [field]: list(1000) })).toEqual([]);
        expect(problemPaths({ name: 'notes', [field]: list(1001) })).toEqual([field]);
      },
    );
  });

  describe('settings', () => {
    const setting = (fields: Record<string, unknown>) => ({
      name: 'notes.max',
      type: 'number',
      default: 5,
      description: 'How many',
      ...fields,
    });

    it('rejects a setting whose name is not under the extension’s own name', () => {
      expect(problems({ name: 'notes', settings: [setting({ name: 'other.max' })] })).toEqual([
        '"other.max" must start with "notes."',
      ]);
    });

    it.each(['max', 'notes.', 'notes.a.b', 'notes.Max'])('rejects the setting name %j', (name) => {
      expect(problems({ name: 'notes', settings: [setting({ name })] }).length).toBeGreaterThan(0);
    });

    it.each([
      ['a string for a number', { type: 'number', default: 'five' }],
      ['a number for a string', { type: 'string', default: 5 }],
      ['a string for a boolean', { type: 'boolean', default: 'yes' }],
    ])('rejects a default that does not match its type: %s', (_what, fields) => {
      expect(problemPaths({ name: 'notes', settings: [setting(fields)] })).toEqual([
        'settings.0.default',
      ]);
    });

    it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
      'rejects the non-finite number default %s',
      (value) => {
        expect(problemPaths({ name: 'notes', settings: [setting({ default: value })] })).toEqual([
          'settings.0.default',
        ]);
      },
    );

    it('caps a setting’s description and string default at 1000 characters', () => {
      const text = (size: number) => 'x'.repeat(size);

      expect(
        problems({
          name: 'notes',
          settings: [
            setting({ description: text(1000) }),
            setting({ name: 'notes.s', type: 'string', default: text(1000) }),
          ],
        }),
      ).toEqual([]);
      expect(
        problemPaths({ name: 'notes', settings: [setting({ description: text(1001) })] }),
      ).toEqual(['settings.0.description']);
      expect(
        problemPaths({
          name: 'notes',
          settings: [setting({ type: 'string', default: text(1001) })],
        }),
      ).toEqual(['settings.0.default']);
      expect(problemPaths({ name: 'notes', $schema: text(1001) })).toEqual(['$schema']);
    });

    it('rejects an unknown type, a missing description and the same name twice', () => {
      expect(problems({ name: 'notes', settings: [setting({ type: 'array' })] }).length).toBe(1);
      expect(problemPaths({ name: 'notes', settings: [setting({ description: '' })] })).toEqual([
        'settings.0.description',
      ]);
      expect(problems({ name: 'notes', settings: [setting({}), setting({})] })).toEqual([
        '"notes.max" is listed twice',
      ]);
    });
  });

  describe('the reserved fields (emits, serves)', () => {
    it('require event kinds and action names inside the extension’s own namespace', () => {
      expect(problems({ name: 'notes', emits: { events: ['other.added'] } })).toEqual([
        '"other.added" must start with "notes."',
      ]);
      expect(problems({ name: 'notes', serves: { actions: ['other.clear'] } })).toEqual([
        '"other.clear" must start with "notes."',
      ]);
    });

    it('require the <extension>.<kind> shape with kebab parts', () => {
      expect(problemPaths({ name: 'notes', emits: { events: ['added'] } })).toContain(
        'emits.events.0',
      );
      expect(problemPaths({ name: 'notes', serves: { actions: ['notes.Clear'] } })).toContain(
        'serves.actions.0',
      );
    });

    it('reject a name listed twice', () => {
      expect(problems({ name: 'notes', emits: { events: ['notes.a', 'notes.a'] } })).toEqual([
        '"notes.a" is listed twice',
      ]);
      expect(problems({ name: 'notes', serves: { actions: ['notes.a', 'notes.a'] } })).toEqual([
        '"notes.a" is listed twice',
      ]);
    });
  });
});
