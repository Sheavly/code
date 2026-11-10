/**
 * The `<kind>` in `<module>.<kind>.ts`, each with the policy the structure rules read.
 * A genuinely new kind is added here (with its
 * policy), never worked around with an odd file name.
 *
 * - `exports`: what the file may export. `types`: only types; `constants`: only literal /
 *   `as const` values; `code`: functions, classes and computed values, but no exported types
 *   or literal constants (those go in the module's types/constants file).
 * - `maxLines`: lines of code (blank and comment lines aside) before a file is doing more than
 *   one job. `null` = no limit (utils and helpers are stateless functions that grow with their
 *   subject).
 * - `classes` (optional): `required` (it exports at least one class) or `forbidden` (it exports
 *   none). Left out, a kind may export classes or not.
 * - `schemas` (optional): `allowed` means it may export zod schemas. Only validators may; a
 *   schema anywhere else stays unexported, or moves to the module's `*.validator.ts`.
 * - `constantsElsewhere` (optional): the file keeps no literal constants, exported or not; they
 *   live in the module's `*.constants.ts`. Left out for kinds whose literals are their content
 *   (types, constants) and for test code, where a fixture value stays beside its test.
 * - `extensions` (optional): the file extensions the kind may have, `['ts']` when left out. Only
 *   `component` (`.tsx`, a React view) and `test` (a component's test may be `.tsx`) differ.
 */
const LINES = { THIN: 150, DEFAULT: 300, TEST: 500, UNLIMITED: null };

export const FILE_KIND_POLICIES = {
  /** Shared contracts. */
  types: { exports: 'types', maxLines: LINES.DEFAULT },
  /** Literal values, `as const` objects. */
  constants: { exports: 'constants', maxLines: LINES.DEFAULT },
  /** Pure helpers: no I/O, no state. */
  utils: { exports: 'code', maxLines: LINES.UNLIMITED, constantsElsewhere: true },
  /**
   * Validation at the edge: zod schemas for external input (files, env, API events, hook exports,
   * tool calls) and the `parse*` functions that turn `unknown` into typed data. Pure, like utils.
   */
  validator: {
    exports: 'code',
    maxLines: LINES.DEFAULT,
    schemas: 'allowed',
    constantsElsewhere: true,
  },
  /** Stateless functions that may do I/O or call services. Functions only, no classes. */
  helper: {
    exports: 'code',
    maxLines: LINES.UNLIMITED,
    classes: 'forbidden',
    constantsElsewhere: true,
  },
  /** Code that owns state: it exports a class. */
  service: {
    exports: 'code',
    maxLines: LINES.DEFAULT,
    classes: 'required',
    constantsElsewhere: true,
  },
  /** Error classes. */
  errors: { exports: 'code', maxLines: LINES.THIN, constantsElsewhere: true },
  /** One agent tool: `create<Name>Tool` returning `defineTool(...)`. */
  tool: { exports: 'code', maxLines: LINES.THIN, constantsElsewhere: true },
  /** One model backend: `defineAdapter(...)`. */
  adapter: { exports: 'code', maxLines: LINES.THIN, constantsElsewhere: true },
  /**
   * One group of HTTP routes: a function building a `Hono` app from what it serves, its handlers
   * inline after each path (so path params and validated bodies stay typed). Thin: a route turns
   * a request into a call and the result into a response, and logic lives in the services.
   */
  routes: { exports: 'code', maxLines: LINES.THIN, classes: 'forbidden', constantsElsewhere: true },
  /**
   * One React view: a function component (Ink, in the terminal app). Its props type lives in the
   * module's `*.types.ts`, like any type. Thin: a view draws what it is given, and what to show,
   * and when, is decided in the code it calls.
   */
  component: {
    exports: 'code',
    maxLines: LINES.THIN,
    classes: 'forbidden',
    constantsElsewhere: true,
    extensions: ['tsx'],
  },
  /** Test-only fakes, in a `testing/` folder. */
  fake: { exports: 'code', maxLines: LINES.DEFAULT },
  /** Vitest files, in a `__tests__` folder beside the module they test. */
  test: { exports: 'code', maxLines: LINES.TEST, extensions: ['ts', 'tsx'] },
};

export const FILE_KINDS = Object.keys(FILE_KIND_POLICIES);

/** The folder test files live in, beside the module they test. */
export const TEST_FOLDER = '__tests__';

/** Lines of code for files without a kind (entry points, the demo). */
export const DEFAULT_MAX_LINES = LINES.DEFAULT;

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
const KIND_IN_NAME = new RegExp(`^${KEBAB}(?:\\.${KEBAB})*\\.(${KEBAB})\\.(tsx?)$`);

/** The extensions (without the dot) files of `kind` may have. */
export function extensionsOf(kind) {
  return FILE_KIND_POLICIES[kind].extensions ?? ['ts'];
}

/** The ESLint globs of one kind's files, one for each extension the kind allows. */
export function globsOfKind(kind) {
  return extensionsOf(kind).map((extension) => `**/*.${kind}.${extension}`);
}

/**
 * The kind in a file name (`tasks.service.ts` → `service`), or null when it names none or has an
 * extension the kind doesn't allow (`tasks.service.tsx`).
 */
export function kindOfFile(fileName) {
  const [, kind, extension] = KIND_IN_NAME.exec(fileName.split(/[\\/]/).at(-1)) ?? [];

  return kind && FILE_KINDS.includes(kind) && extensionsOf(kind).includes(extension) ? kind : null;
}
