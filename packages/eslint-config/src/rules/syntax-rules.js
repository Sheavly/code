// Conventions written as AST selectors, each under its own rule ID, so a
// `files:` override can switch one off without restating the others.

const PARAMS_OBJECT_MESSAGE =
  'Functions with more than one input take a single `params` object, destructured on the first line: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.';

/** Modules that read or write the terminal. */
const TERMINAL_MODULES = '/^(node:)?(readline|tty)(\\u002Fpromises)?$/';
const STDIO = '/^(stdin|stdout|stderr)$/';
const TERMINAL_IO_MESSAGE =
  'No terminal I/O (node:readline, node:tty, process.stdin/stdout/stderr) outside an app: the harness emits typed events and a UI renders them. A UI is an app in apps/ (`npm run new -- app <name> …`), built only when its issue asks for one; a package that formats output takes a write function from the app instead.';

export const SYNTAX_RULES = {
  'no-default-export': [
    {
      selector: 'ExportDefaultDeclaration',
      message: 'Use named exports, so imports and renames stay greppable.',
    },
  ],
  'no-process-env': [
    {
      selector: "MemberExpression[object.name='process'][property.name=/^(env|loadEnvFile)$/]",
      message:
        'Read env only in an app (apps/*): it loads `.env` and passes `process.env` in (`createCodingHarness({ env })`). A package takes the values, or an `Environment` (`@sheavly/core/environment/environment.types`), as options; it never reads env itself.',
    },
  ],
  // Only module-level functions: inline callbacks (`.map((x, i) => ...)`) and class methods
  // have signatures their caller dictates.
  'params-object': [
    { selector: 'FunctionDeclaration[params.length>1]', message: PARAMS_OBJECT_MESSAGE },
    {
      selector:
        ':matches(Program > VariableDeclaration, Program > ExportNamedDeclaration > VariableDeclaration) > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)[params.length>1]',
      message: PARAMS_OBJECT_MESSAGE,
    },
  ],
  'no-barrel': [
    {
      selector: 'ExportAllDeclaration, ExportNamedDeclaration[source]',
      message:
        "No re-exports (barrels). Import from the defining `<name>.<kind>.ts` file, or a package's exported subpath (`@sheavly/core/tool/tool.utils`).",
    },
  ],
  // The harness is a backend: it emits typed events and registries, and renders nothing. Only an
  // app (a workspace in apps/) is exempt; `baseConfig` reads that from where it is.
  'no-terminal-io': [
    {
      selector: `ImportDeclaration[source.value=${TERMINAL_MODULES}], ImportExpression[source.value=${TERMINAL_MODULES}]`,
      message: TERMINAL_IO_MESSAGE,
    },
    {
      selector: `MemberExpression[object.name='process'][property.name=${STDIO}]`,
      message: TERMINAL_IO_MESSAGE,
    },
    {
      selector: `ImportDeclaration[source.value=/^(node:)?process$/] > ImportSpecifier[imported.name=${STDIO}], VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name=${STDIO}]`,
      message: TERMINAL_IO_MESSAGE,
    },
  ],
  // Dates are Luxon's, and the current time is read in one place, `now()`
  // (`@sheavly/core/clock/clock.helper`): a timestamp is epoch milliseconds from it, and a test
  // fixes it with `useFixedClock`. Tests follow the same rule: they build dates with Luxon too.
  'no-direct-clock': [
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message:
        'Read the time with `now()` (`@sheavly/core/clock/clock.helper`), not `Date.now()`: it is the one place the clock is read, so a test can fix it (`useFixedClock` from `@sheavly/testing/clock/fixed-clock.fake`). To time how long something took, use `performance.now()`.',
    },
    {
      selector: "NewExpression[callee.name='Date']",
      message:
        'Use Luxon (`DateTime`) for dates, or `now()` (`@sheavly/core/clock/clock.helper`) for the current time as epoch milliseconds, not `new Date()`: one clock, so a test can fix it and a timestamp is always a `timestampSchema` value.',
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name=/^(UTC|parse)$/]",
      message:
        'Use Luxon for dates: `DateTime.utc(2026, 11, 2).toMillis()`, not `Date.UTC` / `Date.parse`. Times are stored and sent as epoch milliseconds (`timestampSchema`); format one for a person with `DateTime.fromMillis(at).toFormat(...)`.',
    },
    // A time is epoch milliseconds everywhere it is stored or sent, so no code writes or reads an
    // ISO 8601 string: a second format means a second parser, and files that disagree.
    {
      selector:
        'CallExpression[callee.property.name=/^(toISOString|toISO|toISODate|toISOTime|fromISO|fromISODate)$/]',
      message:
        'Times are epoch milliseconds (`timestampSchema`), never ISO 8601 strings: keep the number, and format it for a person only at the edge with `DateTime.fromMillis(at).toFormat(...)` or `.toLocaleString(...)`.',
    },
    {
      selector: "MemberExpression[object.name='z'][property.name='iso']",
      message:
        'Times are epoch milliseconds (`timestampSchema` from `@sheavly/protocol/time/time.validator`), never ISO 8601 strings, so a schema takes no `z.iso.*`.',
    },
  ],
  // `relative.startsWith('..')` also matches a folder named `..x/`, so an "is inside" check built
  // on it lets that folder count as outside (or refuses it as inside).
  'no-dotdot-prefix': [
    {
      selector: "CallExpression[callee.property.name='startsWith'][arguments.0.value='..']",
      message:
        "`startsWith('..')` also matches a folder named `..x/`. To test whether a path is inside a folder use `isInside` (`@sheavly/workspace`'s `workspace/workspace.utils`); elsewhere, compare `relative === '..' || relative.startsWith(`..${path.sep}`)`.",
    },
  ],
};

/** A rule that reports every node matching one of `entries`' selectors with its message. */
export function syntaxRule(entries) {
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      messages: Object.fromEntries(entries.map(({ message }, index) => [`m${index}`, message])),
    },
    create(context) {
      return Object.fromEntries(
        entries.map(({ selector }, index) => [
          selector,
          (node) => context.report({ node, messageId: `m${index}` }),
        ]),
      );
    },
  };
}
