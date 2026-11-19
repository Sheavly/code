import { RUN_SERVICE_GRANTS } from './run-service-grants.constants.js';
import type {
  GrantedArgument,
  GrantedMember,
  GrantedService,
  GrantEntry,
} from './run-service-grants.types.js';

/** The table read as plain data, so a lookup by a name known only at run time type-checks. */
const TABLE: Readonly<Record<string, Readonly<Record<string, GrantEntry>>>> = RUN_SERVICE_GRANTS;

/**
 * Own names only, and only strings: `Object.hasOwn` turns any other value into a key (an object
 * with a `toString`, a one-element array), so a caller past the types never resolves by accident.
 * `String` is used for the message because a template literal throws a `TypeError` on a Symbol.
 */
function ownEntry<TEntry>(params: {
  table: Readonly<Record<string, TEntry>>;
  name: unknown;
  refusal: (shown: string) => string;
}): TEntry {
  const { table, name, refusal } = params;
  const entry = typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : undefined;

  if (entry === undefined) throw new RangeError(refusal(String(name)));

  return entry;
}

/** The members of `service`; throws for a name that is not an own service of the table. */
function membersOf(service: unknown): Readonly<Record<string, GrantEntry>> {
  return ownEntry({
    table: TABLE,
    name: service,
    refusal: (shown) => `${shown} is not a service in the table`,
  });
}

function entryOf(params: { service: GrantedService; member: unknown }): GrantEntry {
  return ownEntry({
    table: membersOf(params.service),
    name: params.member,
    refusal: (shown) => `${params.service} declares no grant for ${shown}`,
  });
}

/**
 * The grant `member` of `service` needs, or with `argument` the grant that argument needs. The
 * names are checked against the table at compile time, so the throw is for a caller that got
 * past the types.
 */
export function grantOf<
  TService extends GrantedService,
  TMember extends GrantedMember<TService>,
>(params: {
  service: TService;
  member: TMember;
  argument?: GrantedArgument<TService, TMember> | undefined;
}): string {
  const { service, member, argument } = params;
  const entry = entryOf({ service, member });

  if (typeof entry === 'string') return entry;

  if (argument === undefined) return entry.grant;

  return ownEntry({
    table: entry.arguments,
    name: argument,
    refusal: (shown) => `${service}.${String(member)} declares no grant for ${shown}`,
  });
}

/**
 * The grants `service` needs, each once, in the order the table first names them: a new array on
 * every call, so a caller cannot change what the next one gets. Throws a `RangeError` for a name
 * that is not a service of the table.
 */
export function grantsOfService(service: GrantedService): readonly string[] {
  const grants = new Set<string>();

  for (const entry of Object.values(membersOf(service))) {
    if (typeof entry === 'string') {
      grants.add(entry);
      continue;
    }

    grants.add(entry.grant);

    for (const grant of Object.values(entry.arguments)) grants.add(grant);
  }

  return [...grants];
}
