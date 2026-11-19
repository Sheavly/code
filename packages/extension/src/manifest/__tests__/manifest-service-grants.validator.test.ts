import { describe, expect, it } from 'vitest';
import { ExtensionDefinitionError } from '../../errors/extension.errors.js';
import { defineExtension } from '../../extension/extension.utils.js';
import { SYSTEM_PROMPT_EXTEND_GRANT } from '../../instructions/instructions.constants.js';
import { extensionManifestSchema } from '../manifest.validator.js';

/** Where and what is wrong with `input` as a manifest, one entry per problem. */
function problems(input: unknown): { path: string; message: string }[] {
  const { error } = extensionManifestSchema.safeParse(input);

  return (error?.issues ?? []).map(({ path, message }) => ({ path: path.join('.'), message }));
}

/** A manifest that provides `sub-agents` and declares `grants` for the services in it. */
function manifestWith(grants: unknown, provides = ['sub-agents']) {
  return { name: 'agents', services: { provides, grants } };
}

describe('the manifest services.grants field', () => {
  it('is absent from a manifest that declares none', () => {
    expect(extensionManifestSchema.parse({ name: 'notes' }).services.grants).toBeUndefined();
  });

  it('accepts the grants of a provided service', () => {
    const parsed = extensionManifestSchema.parse(
      manifestWith({ 'sub-agents': ['sub-agent:share', 'sub-agent:create'] }),
    );

    expect(parsed.services.grants).toEqual({
      'sub-agents': ['sub-agent:share', 'sub-agent:create'],
    });
  });

  it('rejects a grant that is not <noun>:<verb>, naming the path', () => {
    const found = problems(manifestWith({ 'sub-agents': ['Share'] }));

    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('services.grants.sub-agents.0');
    expect(found[0]?.message).toContain('<noun>:<verb>');
  });

  it('rejects a grants key that is not a service name', () => {
    expect(problems(manifestWith({ 'Sub*': ['a:b'] }, ['Sub*'])).length).toBeGreaterThan(0);
  });

  it('rejects grants for a service the extension does not provide, at services.grants.<name>', () => {
    expect(problems(manifestWith({ tasks: ['task:start'] }))).toEqual([
      {
        path: 'services.grants.tasks',
        message: '"tasks" is not in services.provides: only a provided service can declare grants',
      },
    ]);
  });

  it('rejects a grant listed twice for one service, at the repeat', () => {
    expect(problems(manifestWith({ 'sub-agents': ['a:b', 'c:d', 'a:b'] }))).toEqual([
      { path: 'services.grants.sub-agents.2', message: '"a:b" is listed twice' },
    ]);
  });

  it('accepts one grant under two services', () => {
    expect(problems(manifestWith({ one: ['a:b'], two: ['a:b'] }, ['one', 'two']))).toEqual([]);
  });

  it('rejects a grant the host offers itself', () => {
    expect(problems(manifestWith({ 'sub-agents': [SYSTEM_PROMPT_EXTEND_GRANT] }))).toEqual([
      {
        path: 'services.grants.sub-agents.0',
        message: `"${SYSTEM_PROMPT_EXTEND_GRANT}" is a grant the host offers itself`,
      },
    ]);
  });

  it('rejects more grants for a service than the list bound', () => {
    const many = Array.from({ length: 1001 }, (_, index) => `a:b${index}`);

    expect(problems(manifestWith({ 'sub-agents': many })).length).toBeGreaterThan(0);
  });

  it('holds a manifest built in memory to the same rules, at defineExtension', () => {
    expect(() =>
      defineExtension({
        manifest: extensionManifestSchema.parse({ name: 'agents' }),
        activate: () => ({}),
      }),
    ).not.toThrow();
    expect(() =>
      defineExtension({
        manifest: {
          ...extensionManifestSchema.parse({ name: 'agents' }),
          services: { requires: [], optional: [], provides: [], grants: { x: ['a:b'] } },
        },
        activate: () => ({}),
      }),
    ).toThrow(ExtensionDefinitionError);
  });
});
