import type { RUN_SERVICE_GRANTS } from './run-service-grants.constants.js';

/** The table `RUN_SERVICE_GRANTS` as the compiler reads it: every name in it is a literal type. */
export type RunServiceGrants = typeof RUN_SERVICE_GRANTS;

/** The name of a scoped run service that has gated members. */
export type GrantedService = keyof RunServiceGrants;

/** The members of `TService` the table declares. */
export type GrantedMember<TService extends GrantedService> = keyof RunServiceGrants[TService];

/** One entry of the table: a grant, or a grant with the grants of its optional arguments. */
export type GrantEntry =
  string | { readonly grant: string; readonly arguments: Readonly<Record<string, string>> };

/** The arguments of `TMember` that need a grant of their own: `never` for a plain grant string. */
export type GrantedArgument<
  TService extends GrantedService,
  TMember extends GrantedMember<TService>,
> = RunServiceGrants[TService][TMember] extends { readonly arguments: infer TArguments }
  ? keyof TArguments & string
  : never;
