// Conventions written as AST selectors, each under its own rule ID, so a
// `files:` override can switch one off without restating the others.

const PARAMS_OBJECT_MESSAGE =
  'Functions with more than one input take a single `params` object, destructured on the first line: `function f(params: { a: A; b: B }) { const { a, b } = params; }`.';

/** Modules that read or write the terminal. */
const TERMINAL_MODULES = '/^(node:)?(readline|tty)(\\u002Fpromises)?$/';
const STDIO = '/^(stdin|stdout|stderr)$/';
const TERMINAL_IO_MESSAGE =
  'No terminal I/O (node:readline, node:tty, process.stdin/stdout/stderr) outside an app: the harness emits typed events and a UI renders them. A UI is an app in apps/ (`npm run new -- app <name> …`), built only when its issue asks for one; a package that formats output takes a write function from the app instead.';

/**
 * The modules that read and write files. Imported by name (`import { writeFile } from
 * 'node:fs/promises'`) the functions are visible; as a whole (`import fs`, `import('node:fs')`)
 * they are not, so those are banned where writing is.
 */
const FS_MODULES = '/^(node:)?fs(\\u002Fpromises)?$/';
/** The functions that create, change, move or delete a file or folder (`open` can write). */
const FS_MUTATORS =
  '/^(writeFile|appendFile|rename|rm|rmdir|unlink|mkdir|mkdtemp|cp|copyFile|createWriteStream|truncate|ftruncate|symlink|link|chmod|chown|utimes|open|write|writev)(Sync)?$/';
const FILE_WRITES_MESSAGE =
  "Do not write, move or delete files by hand. The user's data goes through `@sheavly/storage` (`writeJsonFile`, `appendJsonLine`, `DocumentFile`, the stores): atomic, private, retried on Windows, and the path is checked. The agent's file tools write a project through `Workspace`. A justified exception is a `files:` override with a reason, in this workspace's eslint.config.js.";

/**
 * The credentials file as the last part of a path, in any case (macOS and Windows file systems
 * ignore it, so `Credentials.JSON` is the same file): the whole string, or what follows a `/` or
 * `\`. A message that only mentions the name in a sentence is not a path and is not matched.
 */
const CREDENTIALS_PATH = '/(^|[\\\\\\u002F])credentials\\.json$/i';
/**
 * The modules that hand out keys, imported by package subpath: the credential store itself, and
 * the profile registry, whose open profiles read and set them. Whatever can import either can
 * read a key, so both are on this list.
 */
const KEY_HOLDER_MODULES =
  '/^@sheavly\\u002Fstorage\\u002F(credential-store|profile-registry)\\u002F/';

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
  // The credentials file holds every model's key. Reading it is `CredentialStore`'s job and the
  // backend's alone (which serves it to nobody): the store checks that the file is private, never
  // puts a key in an error and queues writes, none of which code that opens the file itself does.
  // So no other code names the file, or imports the module that does.
  'no-credentials-file': [
    {
      selector: `Literal[value=${CREDENTIALS_PATH}], TemplateElement[value.cooked=${CREDENTIALS_PATH}]`,
      message:
        'Do not name the credentials file (`credentials.json`). Keys are read and written through `CredentialStore` (`@sheavly/storage/credential-store/credential-store.service`), which refuses a file others can read and never puts a key in an error. Only the backend app uses it; any other code asks the backend (a UI) or is given the secret it needs as an option.',
    },
  ],
  'no-key-holder-import': [
    {
      selector: `ImportDeclaration[source.value=${KEY_HOLDER_MODULES}], ImportExpression[source.value=${KEY_HOLDER_MODULES}]`,
      message:
        "Only the backend app (apps/backend) imports the credential store or the profile registry: it is where a key is read and handed to a provider. Other code never holds a key: a UI sets one through the backend's API, and a package is given what it needs as an option. In the backend, turn this rule off for the one module that holds keys, with a `files:` override and its reason in apps/backend/eslint.config.js.",
    },
  ],
  // Files are written in one place. The user's data (conversations, models, trust, config) goes
  // through `@sheavly/storage`, which writes atomically and privately, retries on Windows and
  // checks every path; the agent's file tools write a project through `Workspace`. A hand-rolled
  // write elsewhere is how a trust file ended up with a temp name two writes could share.
  'no-direct-file-writes': [
    {
      selector: `ImportDeclaration[source.value=${FS_MODULES}] > ImportSpecifier[imported.name=${FS_MUTATORS}]`,
      message: FILE_WRITES_MESSAGE,
    },
    {
      selector: `ImportDeclaration[source.value=${FS_MODULES}] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)`,
      message: `${FILE_WRITES_MESSAGE} Import what you read by name (\`import { readFile } from 'node:fs/promises'\`): a whole-module import hides what is written.`,
    },
    {
      selector: `ImportExpression[source.value=${FS_MODULES}]`,
      message: `${FILE_WRITES_MESSAGE} Import what you read by name: a dynamic import hides what is written.`,
    },
  ],
  // A harness notice reaches a model through `formatHarnessNotice`, which owns the envelope: its
  // origin line, its handling policy, and the escaping of what is inserted inside it. Text built
  // by hand skips all three, so a report or a tool's output could close the envelope early. Lint
  // catches the accident: a string or template piece holding `harness-notice` (even without a
  // bracket, so a path or label of that name is flagged too) or `<harness`, `</harness`. It cannot
  // see a tag split inside a word or built from a variable, so the formatter's escaping and its
  // tests carry the guarantee.
  'no-handwritten-notice': [
    {
      selector:
        'Literal[value=/<\\/?harness|harness-notice/i], TemplateElement[value.cooked=/<\\/?harness|harness-notice/i]',
      message:
        'Do not write a `<harness-notice` envelope by hand. Add the notice as a kind of `harnessNoticeSchema` (`@sheavly/protocol/notice/notice.validator`) and format it in `formatHarnessNotice` (`@sheavly/core/notice/notice.utils`), whose wording lives in `notice.constants.ts`: it frames the text as harness data, not a user message, and escapes what is inserted inside it.',
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
