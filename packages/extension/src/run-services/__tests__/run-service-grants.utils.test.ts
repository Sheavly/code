import { afterEach, describe, expect, it } from 'vitest';
import { GRANT_PATTERN } from '../../manifest/manifest.constants.js';
import { RUN_SERVICE_GRANTS } from '../run-service-grants.constants.js';
import type { GrantEntry } from '../run-service-grants.types.js';
import { grantOf, grantsOfService } from '../run-service-grants.utils.js';
import * as exported from '../run-services.utils.js';

/** The name of every service key `run-services.utils` exports: the exports are the list. */
const keyNames = Object.values(exported).flatMap((value) => value.name);

const table: Record<string, Record<string, GrantEntry>> = RUN_SERVICE_GRANTS;

/** Every grant the table names, with where it is named, for a failure that says which entry. */
const grants = Object.entries(table).flatMap(([service, members]) =>
  Object.entries(members).flatMap(([member, entry]) =>
    typeof entry === 'string'
      ? [{ at: `${service}.${member}`, grant: entry }]
      : [
          { at: `${service}.${member}`, grant: entry.grant },
          ...Object.entries(entry.arguments).map(([argument, grant]) => ({
            at: `${service}.${member}.${argument}`,
            grant,
          })),
        ],
  ),
);

describe('RUN_SERVICE_GRANTS', () => {
  it('names only services whose key the extension package defines', () => {
    for (const service of Object.keys(table)) {
      expect(keyNames, service).toContain(service);
    }
  });

  it('leaves out exactly the services that need no grant', () => {
    const absent = keyNames.filter((name) => !(name in table)).sort();

    expect(absent).toEqual(['instructions', 'main-session']);
  });

  it('gives every service at least one member', () => {
    for (const [service, members] of Object.entries(table)) {
      expect(Object.keys(members).length, service).toBeGreaterThan(0);
    }
  });

  it('holds only a grant string or a grant with a non-empty map of argument grants', () => {
    for (const [service, members] of Object.entries(table)) {
      for (const [member, entry] of Object.entries(members)) {
        if (typeof entry === 'string') continue;

        expect(Object.keys(entry).sort(), `${service}.${member}`).toEqual(['arguments', 'grant']);
        expect(Object.keys(entry.arguments).length, `${service}.${member}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(grants)('names $grant at $at in the manifest’s <noun>:<verb> form', ({ grant }) => {
    expect(grant).toMatch(GRANT_PATTERN);
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Every object of the table, with the path that names it, the table itself first. */
function objectsOf(params: {
  value: Record<string, unknown>;
  at: string;
}): { at: string; value: Record<string, unknown> }[] {
  const inner = Object.entries(params.value).flatMap(([name, child]) =>
    isRecord(child) ? objectsOf({ value: child, at: `${params.at}.${name}` }) : [],
  );

  return [{ at: params.at, value: params.value }, ...inner];
}

const objects = objectsOf({ value: table, at: 'RUN_SERVICE_GRANTS' });

describe('RUN_SERVICE_GRANTS is frozen when its module loads', () => {
  it('has more than one level to walk', () => {
    expect(objects.length).toBeGreaterThan(Object.keys(table).length);
  });

  it.each(objects)('freezes $at', ({ value }) => {
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each(objects)('refuses assigning, adding, deleting and redefining at $at', ({ value }) => {
    const target = value;
    const [name = 'missing'] = Object.keys(target);

    expect(() => {
      target[name] = 'task:read-any';
    }).toThrow(TypeError);
    expect(() => {
      target.added = 'task:read-any';
    }).toThrow(TypeError);
    // A value no entry holds: redefining a property with its own value is not a change.
    expect(() => Object.defineProperty(target, name, { value: 'other:grant' })).toThrow(TypeError);
    expect(() => Object.defineProperty(target, 'added', { value: 'other:grant' })).toThrow(
      TypeError,
    );
    // `Reflect` reports the refusal a strict `delete` would throw.
    expect(Reflect.deleteProperty(target, name)).toBe(false);
  });

  it('keeps the grant a refused mutation aimed at', () => {
    const members: Record<string, unknown> = table['task-control'] ?? {};

    expect(() => {
      members.cancel = 'task:read-any';
    }).toThrow(TypeError);
    expect(grantOf({ service: 'task-control', member: 'cancel' })).toBe('task:cancel-any');
  });
});

describe('grantOf', () => {
  it('answers the grant of a plain member', () => {
    expect(grantOf({ service: 'session-info', member: 'list' })).toBe('session:read');
  });

  it('answers the member’s own grant without an argument, and the argument’s with one', () => {
    expect(grantOf({ service: 'approvals', member: 'request' })).toBe('approval:request');
    expect(grantOf({ service: 'approvals', member: 'request', argument: 'tool' })).toBe(
      'approval:as-tool',
    );
    expect(grantOf({ service: 'approvals', member: 'request', argument: 'keeps' })).toBe(
      'approval:keep',
    );
  });
});

describe('a name that is not an own member of the table', () => {
  const polluted = 'pollutedGrantName';

  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, polluted);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'is refused as a member by grantOf: %s',
    (member) => {
      expect(() => grantOf({ service: 'session-info', member } as never)).toThrow(RangeError);
    },
  );

  it.each(['constructor', 'toString', '__proto__'])(
    'is refused as a service by grantOf and grantsOfService: %s',
    (service) => {
      expect(() => grantOf({ service, member: 'get' } as never)).toThrow(RangeError);
      expect(() => grantsOfService(service as never)).toThrow(RangeError);
    },
  );

  it('is refused as an argument by grantOf, whatever the prototype holds', () => {
    expect(() =>
      grantOf({ service: 'approvals', member: 'request', argument: 'constructor' } as never),
    ).toThrow(RangeError);
  });

  it('is refused when Object.prototype was polluted with it', () => {
    Object.defineProperty(Object.prototype, polluted, {
      value: 'session:read',
      configurable: true,
    });

    expect(() => grantOf({ service: 'session-info', member: polluted } as never)).toThrow(
      RangeError,
    );
    expect(() => grantOf({ service: polluted, member: 'get' } as never)).toThrow(RangeError);
    expect(() => grantsOfService(polluted as never)).toThrow(RangeError);
  });
});

describe('a name that is not a string', () => {
  const notStrings = {
    'an object whose toString answers a name': { toString: () => 'session-info' },
    'an array holding a name': ['session-info'],
    'a symbol': Symbol('session-info'),
    'a number': 1,
    undefined,
    null: null,
  };

  it.each(Object.entries(notStrings))('is refused as a service: %s', (_, service) => {
    expect(() => grantOf({ service, member: 'list' } as never)).toThrow(RangeError);
    expect(() => grantsOfService(service as never)).toThrow(RangeError);
  });

  it.each(Object.entries(notStrings))('is refused as a member: %s', (_, member) => {
    const named = { toString: () => 'list' };

    expect(() => grantOf({ service: 'session-info', member } as never)).toThrow(RangeError);
    expect(() => grantOf({ service: 'session-info', member: named } as never)).toThrow(RangeError);
  });

  // An `undefined` argument means no argument: the member's own grant.
  const asArgument = Object.entries(notStrings).filter(([, value]) => value !== undefined);

  it.each(asArgument)('is refused as an argument: %s', (_, argument) => {
    const named = { toString: () => 'tool' };

    expect(() => grantOf({ service: 'approvals', member: 'request', argument } as never)).toThrow(
      RangeError,
    );
    expect(() =>
      grantOf({ service: 'approvals', member: 'request', argument: named } as never),
    ).toThrow(RangeError);
  });
});

describe('grantsOfService', () => {
  it('returns a new array on every call, so a caller cannot change the next answer', () => {
    // The type is readonly; a caller past it still cannot change the next answer.
    const first = grantsOfService('model') as string[];

    first.push('model:other');

    expect(grantsOfService('model')).toEqual(['model:call']);
    expect(grantsOfService('model')).not.toBe(grantsOfService('model'));
  });

  it('lists each grant of a service once, in the order the table first names it', () => {
    expect(grantsOfService('child-sessions')).toEqual([
      'sub-agent:create',
      'sub-agent:message',
      'sub-agent:observe',
      'sub-agent:report',
    ]);
  });

  it('includes the grants of the arguments after the member’s own', () => {
    expect(grantsOfService('approvals')).toEqual([
      'approval:request',
      'approval:as-tool',
      'approval:keep',
    ]);
  });
});
