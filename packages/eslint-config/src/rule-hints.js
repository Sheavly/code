// What to do, appended by the post-edit hook to third-party rules whose messages say what is wrong
// but not how to fix it. Optional per rule: an unlisted rule is reported with its own message, and
// the `harness/*` rules already say what to do. A test fails when a hint names a rule that is off.
export const RULE_HINTS = {
  'sonarjs/cognitive-complexity':
    "Extract the inner step (a loop body, a branch) into a function named for what it does; don't just reshuffle conditions.",
  'max-depth':
    'Flatten with an early `return`/`continue`, or extract the inner block into a named function.',
  'max-nested-callbacks':
    'Give the inner callback a name (a module-level function) instead of nesting another arrow.',
  'no-nested-ternary': 'Branch with early returns, or give each case its own named function.',
  'no-param-reassign': 'Assign to a new `const` instead of the parameter.',
  'max-lines':
    'Split the file by responsibility into another `<name>.<kind>.ts` in the same folder.',
  '@typescript-eslint/no-non-null-assertion':
    "Check a value from outside with a validator (`parseOrThrow`); for state the code guarantees, throw the area's typed error when it is missing.",
  '@typescript-eslint/consistent-type-assertions':
    'Build the value with its type (`const counts: Counts = { … }`) instead of asserting a literal into it.',
  '@typescript-eslint/switch-exhaustiveness-check':
    'Add the missing cases; an unknown value must be an error, not a silent default.',
};
