import { describe, expect, it } from 'vitest';
import { ExtensionUndeclaredError } from '@sheavly/extension/errors/manifest.errors';
import { RUN_SERVICE_GRANTS } from '@sheavly/extension/run-services/run-service-grants.constants';
import type { GrantEntry } from '@sheavly/extension/run-services/run-service-grants.types';
import { runSession } from '@sheavly/loop/stream-agent/stream-agent.helper';
import { MemoryOutputStore } from '@sheavly/testing/store/memory-output.fake';
import { createHarness } from '../../host/host.helper.js';
import { scopeRun } from '../../testing/scope-run.fake.js';
import { runServices } from '../run-services.helper.js';
import { routedProvider, say } from '@sheavly/testing/provider/routed-provider.fake';

const table: Record<string, Record<string, GrantEntry>> = RUN_SERVICE_GRANTS;

/**
 * Members a scope has that the table deliberately leaves out, because they gate nothing: the
 * model scope forwards the provider's context window, which only reads a number.
 */
const UNGATED: Record<string, string[]> = { model: ['contextWindow'] };

/** One thing a scope can be asked that needs a grant: a member, or an argument of a member. */
type Need = { service: string; member: string; argument?: string; grant: string };

const needs: Need[] = Object.entries(table).flatMap(([service, members]) =>
  Object.entries(members).flatMap(([member, entry]) =>
    typeof entry === 'string'
      ? [{ service, member, grant: entry }]
      : [
          { service, member, grant: entry.grant },
          ...Object.entries(entry.arguments).map(([argument, grant]) => ({
            service,
            member,
            argument,
            grant,
          })),
        ],
  ),
);

/** The distinct grants the members of `service` need, read from the table itself. */
function grantsOf(service: string): string[] {
  return [...new Set(needs.filter((need) => need.service === service).map(({ grant }) => grant))];
}

/** A placeholder for an argument that is only worth what the guard says before it reads it. */
const PLACEHOLDERS: Record<string, unknown> = { tool: 'run_command', options: [], keeps: [] };

function isScope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The keys a scope offers to a caller: its own and every prototype's up to `Object.prototype`,
 * symbols included. `#private` fields are not keys, and `constructor` is no member.
 */
function publicMembers(scope: object): (string | symbol)[] {
  const keys = new Set<string | symbol>();

  for (
    let level: object | null = scope;
    level !== null && level !== Object.prototype;
    level = Object.getPrototypeOf(level) as object | null
  ) {
    for (const key of Reflect.ownKeys(level)) keys.add(key);
  }

  keys.delete('constructor');

  return [...keys];
}

/** Calls `member` of `scope` with `input`; async so a method that throws and one that rejects are told alike. */
async function callMember(params: {
  scope: Record<string, unknown>;
  member: string;
  input: unknown;
}): Promise<unknown> {
  const { scope, member, input } = params;
  const target = scope[member];

  if (typeof target !== 'function') return target;

  const result: unknown = await Reflect.apply(target, scope, [input]);

  return result;
}

/** A run with `caller` holding `grants` and reading `service`, over a store so every scope exists. */
async function callerOf(params: { service: string; grants: string[] }) {
  const run = scopeRun({ outputs: new MemoryOutputStore() });

  await run.activate([{ name: 'caller', requires: [params.service], grants: params.grants }]);

  const scope: unknown = run.servicesOf('caller').get({ name: params.service });

  if (!isScope(scope)) throw new Error(`${params.service} is not a scope`);

  return scope;
}

describe('RUN_SERVICE_GRANTS against the scopes the host builds', () => {
  it.each(Object.keys(table))(
    'declares exactly the public members of the %s scope, except the ones that gate nothing',
    async (service) => {
      const scope = await callerOf({ service, grants: grantsOf(service) });
      const ungated = UNGATED[service] ?? [];
      const members = publicMembers(scope);

      // A symbol-keyed member shows as `Symbol(…)`, which no table name equals.
      const named = members.map(String);

      expect(named.filter((name) => !ungated.includes(name)).sort()).toEqual(
        Object.keys(table[service] ?? {}).sort(),
      );

      for (const name of ungated) expect(named, `${service}.${name}`).toContain(name);
    },
  );

  it('offers a service exactly the grants its members need, and every scoped service is in the table', () => {
    const harness = createHarness({ provider: routedProvider({ go: [say('ok')] }), title: 'go' });
    const offered = new Map(
      runServices({ harness, outputs: new MemoryOutputStore(), runSession }).flatMap((service) =>
        'grants' in service ? [[service.name, [...service.grants].sort()] as const] : [],
      ),
    );

    expect([...offered.keys()].sort()).toEqual(Object.keys(table).sort());

    for (const [service, grants] of offered) {
      const used = needs.filter((need) => need.service === service).map(({ grant }) => grant);

      expect(grants, service).toEqual([...new Set(used)].sort());
    }
  });

  it.each(
    needs.map((need) => ({
      ...need,
      label:
        need.argument === undefined
          ? `${need.service}.${need.member}`
          : `${need.service}.${need.member}(${need.argument})`,
    })),
  )('refuses $label without $grant, naming it', async ({ service, member, argument, grant }) => {
    const granted = grantsOf(service).filter((one) => one !== grant);
    const scope = await callerOf({ service, grants: granted });
    const input = argument === undefined ? {} : { [argument]: PLACEHOLDERS[argument] };
    // Async so a method that throws and one that rejects are told alike.
    const attempt = async (): Promise<unknown> => {
      const target = scope[member];

      if (typeof target !== 'function') return target;

      const result: unknown = await Reflect.apply(target, scope, [input]);

      return result;
    };

    await expect(attempt()).rejects.toThrow(ExtensionUndeclaredError);
    await expect(attempt()).rejects.toThrow(new RegExp(`caller.*${grant}`, 's'));
  });
});

describe('an extension that imports the public table', () => {
  const cancel = { id: 'task-1', sessionId: 'session-1' };

  it('cannot change what the host checks: the write throws and cancel still needs task:cancel-any', async () => {
    const control = await callerOf({ service: 'task-control', grants: ['task:read-any'] });
    const refusal = /caller.*task:cancel-any/s;
    const attack = (): void => {
      Object.defineProperty(table['task-control'] ?? {}, 'cancel', { value: 'task:read-any' });
    };

    await expect(callMember({ scope: control, member: 'cancel', input: cancel })).rejects.toThrow(
      refusal,
    );
    expect(attack).toThrow(TypeError);
    await expect(callMember({ scope: control, member: 'cancel', input: cancel })).rejects.toThrow(
      refusal,
    );
  });

  it('cannot weaken an argument grant either', async () => {
    const approvals = await callerOf({ service: 'approvals', grants: ['approval:request'] });
    const request = table.approvals?.request;
    const attack = (): void => {
      Object.defineProperty(typeof request === 'object' ? request.arguments : {}, 'tool', {
        value: 'approval:request',
      });
    };

    expect(attack).toThrow(TypeError);
    await expect(
      callMember({ scope: approvals, member: 'request', input: { tool: 'run_command' } }),
    ).rejects.toThrow(/caller.*approval:as-tool/s);
  });
});

describe('publicMembers', () => {
  class Base {
    #hidden = 1;

    readonly own = this.#hidden;

    inheritedMethod(): number {
      return 1;
    }
  }

  class Middle extends Base {
    middleMethod(): number {
      return 2;
    }
  }

  const marker = Symbol('marker');

  class Leaf extends Middle {
    [marker](): number {
      return 3;
    }
  }

  it('lists members from the whole prototype chain and symbol keys, but no constructor or #private', () => {
    const members = publicMembers(new Leaf());

    expect(members).toEqual(
      expect.arrayContaining(['own', 'inheritedMethod', 'middleMethod', marker]),
    );
    expect(members).not.toContain('constructor');
    expect(members).toHaveLength(4);
  });
});
