/**
 * `value` and everything below it frozen, so a later assignment, delete or `defineProperty`
 * throws in strict mode. Only for plain data (a parsed manifest, a literal table): a frozen
 * object is not walked again, so freeze a structure from the top at the moment it is built.
 */
export function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;

  Object.freeze(value);

  for (const inner of Object.values(value)) deepFreeze(inner);

  return value;
}
