// Pure half of rule-references.mjs: reads the code spans out of a rule file and decides, against
// an index of the repo built by that script, whether each one names something that exists. A span
// that looks like none of the shapes below is prose (`--force`, `idle`) and is skipped; one that
// has a shape and can't be found is a problem, unless the allow-list explains it.

/** The ESLint plugin name the harness's own rules are registered under (`harness/imports`). */
const LINT_PLUGIN = 'harness';
const FENCE = /^\s*(`{3,}|~{3,})/;
// A run of backticks closes only on a run of the same length, as in CommonMark.
const CODE_SPAN = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;

/** Every inline code span in a Markdown file as `{ line, reference }`; fenced blocks are skipped. */
export function extractReferences(text) {
  const references = [];
  let fence = null;

  for (const [index, line] of text.split('\n').entries()) {
    const fenceMatch = FENCE.exec(line);

    if (fenceMatch && (!fence || fenceMatch[1].startsWith(fence))) {
      fence = fence ? null : fenceMatch[1];
      continue;
    }

    if (fence) continue;

    for (const [, , content] of line.matchAll(CODE_SPAN)) {
      const reference = content.trim();

      if (reference) references.push({ line: index + 1, reference });
    }
  }

  return references;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rule files write placeholders as `<name>`, `*`, `**`, `…` and alternatives as `{a,b}`.
const PATH_PLACEHOLDERS = [
  [/\\\*\\\*\/?/g, '(?:.*/)?'],
  [/\\\*/g, '[^/]*'],
  [/<[^>/]+>/g, '[^/]+'],
  [/…|\\\.\\\.\\\./g, '.*'],
];

// A trailing `/**` means everything under a folder, so it is checked as the folder.
const TRAILING_DESCENDANTS = /\/\*\*$|\/$/;

function toPathPattern(reference) {
  const withAlternatives = escapeRegExp(reference.replace(TRAILING_DESCENDANTS, '')).replace(
    /\\\{([^}]*)\\\}/g,
    (_, list) => `(?:${list.split(',').join('|')})`,
  );
  const body = PATH_PLACEHOLDERS.reduce(
    (pattern, [placeholder, replacement]) => pattern.replace(placeholder, replacement),
    withAlternatives,
  );

  // A path may be repo-relative or relative to a workspace or module (`src/index.ts`).
  return new RegExp(`(?:^|/)${body}$`);
}

function toNamePattern(name) {
  return new RegExp(`^${escapeRegExp(name).replace(/<[^>]*>/g, '[\\w$]*')}$`);
}

function hasMatch(params) {
  const { values, pattern } = params;

  for (const value of values) if (pattern.test(value)) return true;

  return false;
}

function stripPlaceholders(text) {
  return text.replace(/<[^>]*>|\{[^}]*\}|\*|…/g, 'x');
}

function isPathShaped(params) {
  const { reference, index } = params;

  if (/[\s'"`=:]|^[@/~]|^\.\//.test(reference)) return false;

  const segments = reference.replace(TRAILING_DESCENDANTS, '').split('/');
  const last = stripPlaceholders(segments.at(-1));
  const extension = /(\.[^.]+)$/.exec(last.replace(/^\./, ''))?.[1];
  // A bare word (`loop`, `test`) is a path only with a slash; folder names double as prose.
  const isFolderPath = reference.includes('/') && index.pathStarts.has(segments[0]);

  return isFolderPath || (extension && index.extensions.has(extension));
}

// Imports name a `.ts` module by its `.js` output, or by subpath with no extension at all.
function pathCandidates(reference) {
  const fromAnywhere = reference.replace(/^(?:\.\.\/)+/, '');

  return [fromAnywhere, fromAnywhere.replace(/\.js$/, '.ts'), `${fromAnywhere}.ts`];
}

function checkPath(params) {
  const { reference, index } = params;
  const isDirectory = TRAILING_DESCENDANTS.test(reference);
  const found = pathCandidates(reference).some((candidate) => {
    const pattern = toPathPattern(candidate);

    return (
      hasMatch({ values: index.dirs, pattern }) ||
      (!isDirectory && hasMatch({ values: index.files, pattern }))
    );
  });

  return found ? null : 'no file or folder in the repo matches this path';
}

const NPM_RUN = /^npm run (\S+)(.*)$/;

// Without `-w`, a rule may also mean "run it in the workspace you are in", so any workspace having
// the script is enough.
function checkNpmScript(params) {
  const { match, index } = params;
  const [, script, rest] = match;
  const workspace = /(?:^|\s)(?:-w|--workspace)[\s=](\S+)/.exec(rest.split(' -- ')[0])?.[1];

  if (!workspace) {
    const isDefined = [...index.scripts.values()].some((scripts) => scripts.has(script));

    return isDefined ? null : `neither the root nor any workspace has a \`${script}\` script`;
  }

  const scripts = index.scripts.get(workspace);

  if (!scripts) return `no workspace \`${workspace}\` to run the script in`;

  return scripts.has(script) ? null : `\`${workspace}\` has no \`${script}\` script`;
}

function checkSpecifier(params) {
  const { reference, index } = params;
  const pattern = new RegExp(`^${escapeRegExp(reference).replace(/<[^>]*>/g, '[\\w-]+')}$`);

  if (hasMatch({ values: index.specifiers, pattern })) return null;

  return 'no workspace has this module or folder';
}

// A rule ID only shows up in code where a config or the plugin names it, as one kebab-case word.
function checkLintRule(params) {
  const { reference, index } = params;
  const name = reference.slice(LINT_PLUGIN.length + 1);
  const pattern = new RegExp(`^${escapeRegExp(name).replace(/\\\*|<[^>]*>/g, '.+')}$`);

  return hasMatch({ values: index.kebabWords, pattern }) ? null : 'no lint config sets this rule';
}

// Compound words are code: camelCase, PascalCase with a second word, SCREAMING_SNAKE, templates.
function isCodeName(part) {
  return /[a-z0-9][A-Z]/.test(part) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(part) || /</.test(part);
}

function stripCalls(reference) {
  let text = reference;

  for (let previous; previous !== text;) {
    previous = text;
    text = text.replace(/\([^()]*\)/g, '');
  }

  return text.replace(/^\./, '').replace(/\[\]$/, '');
}

// A reference that is a single name or chain (`sessions.stream()`, `approvals.respond/pending`).
function readChainNames(reference) {
  const text = stripCalls(reference);

  if (!/^[\w$<>.|/]+$/.test(text) || !/[A-Za-z]/.test(text)) return null;

  return text.split(/[.|/]/).filter(isCodeName);
}

// Inside a snippet a `<Name>` placeholder is part of a name when it touches one
// (`create<Name>Tool`); alone it stands for a whole name. After a name and before nothing, it is a
// type argument.
const PLACEHOLDER = '<[A-Za-z]+>(?=[\\w$])';
const SNIPPET_NAME = new RegExp(`(?:[A-Za-z_$]|${PLACEHOLDER})(?:[\\w$]|${PLACEHOLDER})*`, 'g');
const LONE_PLACEHOLDER = /(?<![\w$])<[A-Za-z]+>(?![\w$])/g;
const STRING_LITERAL = /'[^']*'|"[^"]*"|`[^`]*`/g;

function readCodeNames(reference) {
  const chain = readChainNames(reference);

  if (chain) return chain;

  const code = reference.replace(STRING_LITERAL, '').replace(LONE_PLACEHOLDER, '');

  return [...new Set([...code.matchAll(SNIPPET_NAME)].map(([name]) => name))].filter(isCodeName);
}

function checkNames(params) {
  const { reference, index, allowlist } = params;
  const unknown = readCodeNames(reference).filter((name) => {
    return !hasMatch({ values: index.words, pattern: toNamePattern(name) });
  });
  const missing = unknown.filter((name) => !allowlist.has(name));
  const allowed = unknown.filter((name) => allowlist.has(name));

  if (missing.length === 0) return { problem: null, allowed };

  const names = missing.map((name) => `\`${name}\``).join(', ');

  return { problem: `${names} appears in no code in the repo`, allowed };
}

const CHECKS = {
  'npm-script': ({ reference, index }) => {
    return checkNpmScript({ match: NPM_RUN.exec(reference), index });
  },
  specifier: checkSpecifier,
  'lint-rule': checkLintRule,
  path: checkPath,
  prose: () => null,
};

/** Which kind of reference this is, which decides how it is looked up; `prose` isn't checked. */
function classifyReference(params) {
  const { reference, index } = params;

  if (NPM_RUN.test(reference)) return 'npm-script';
  if (reference.includes('://')) return 'prose';
  if (reference.startsWith(`@${index.scope}/`)) return 'specifier';
  if (new RegExp(`^${LINT_PLUGIN}/[\\w*<>-]+$`).test(reference)) return 'lint-rule';
  if (isPathShaped({ reference, index })) return 'path';

  return readCodeNames(reference).length > 0 ? 'names' : 'prose';
}

/**
 * Whether `reference` points at nothing, as `{ problem, allowed }`: `problem` is why (null when
 * it resolves, is prose or is excused), `allowed` the `allowlist` entries that excused it. An
 * entry names either the whole reference or one name in it. `index` is
 * `{ files, dirs, extensions, pathStarts, scripts, specifiers, scope, words, kebabWords }`.
 */
export function findReferenceProblem(params) {
  const { reference, allowlist } = params;
  const kind = classifyReference(params);
  const result =
    kind === 'names' ? checkNames(params) : { problem: CHECKS[kind](params), allowed: [] };

  if (result.problem && allowlist.has(reference)) return { problem: null, allowed: [reference] };

  return result;
}
