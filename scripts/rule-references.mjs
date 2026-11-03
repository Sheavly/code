// Code that AGENTS.md or a skill names and that no longer exists: a path, a workspace import, an
// npm script, a `harness/*` lint rule, or a function or constant name in backticks. Agents follow
// those files with confidence, so a rename that leaves one stale must not pass.
//
// "Exists" is read off the repo's own files (tracked and untracked, never ignored output such as
// `dist/`), with the Markdown left out so a rule file can't vouch for itself. A reference that is
// meant to point outside the repo goes in rule-references.allowlist.json with the reason; an
// entry no rule file needs any more fails too, so the list can't rot either.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TEST_FOLDER } from '../packages/eslint-config/src/file-kinds.js';
import { listWorkspaces } from '../packages/eslint-config/src/layout.utils.js';
import { extractReferences, findReferenceProblem } from './rule-references.utils.mjs';

/** The files agents follow as rules. */
const RULE_FILE_GLOBS = ['AGENTS.md', '.agents/skills/**/*.md'];
const ALLOWLIST_FILE = 'scripts/rule-references.allowlist.json';
// The formats rule files are written in; their text is what is being checked, never evidence.
const PROSE_EXTENSIONS = new Set(['.md', '.mdc']);
const SOURCE_FILE = /^src\/(.+)\.ts$/;

const FIX =
  'Update it to the current name or path, or delete the sentence if the code is gone. A reference meant to point outside this repo (a library API, an external tool) goes in scripts/rule-references.allowlist.json with the reason.';

// Tests' fixtures are made-up names, so they can't keep a real one alive either.
function isEvidence(file) {
  const isTest = file.split('/').includes(TEST_FOLDER);

  return !isTest && !PROSE_EXTENSIONS.has(path.posix.extname(file)) && file !== ALLOWLIST_FILE;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (caughtError) {
    throw new Error(`Cannot read ${file}: ${caughtError.message}`, { cause: caughtError });
  }
}

function listDirs(files) {
  const dirs = new Set();

  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) {
      dirs.add(dir);
    }
  }

  return dirs;
}

function readScope(root) {
  const { name } = readJson(path.join(root, 'package.json'));
  const scope = /^@([^/]+)\//.exec(name ?? '')?.[1];

  if (!scope) throw new Error(`${root}/package.json has no scoped name to read the scope off.`);

  return scope;
}

function readScripts(params) {
  const { root, workspaces } = params;
  const scripts = new Map([
    ['', new Set(Object.keys(readJson(path.join(root, 'package.json')).scripts ?? {}))],
  ]);

  for (const workspace of workspaces) {
    const names = new Set(Object.keys(workspace.manifest.scripts ?? {}));

    scripts.set(workspace.name, names);
    scripts.set(workspace.relative, names);
  }

  return scripts;
}

/**
 * Every workspace module a rule can name by import specifier: the workspace itself, each `src/`
 * module by subpath (`@sheavly/core/tool/tool.utils`) and each module folder
 * (`@sheavly/tools/sub-agent/`). Rules also name closed modules to say where code lives, so this
 * is what exists, not what `exports` makes public (`harness/imports` checks that in code).
 */
function listSpecifiers(params) {
  const { files, workspaces } = params;
  const specifiers = new Set();

  for (const { name, relative } of workspaces) {
    specifiers.add(name);

    for (const file of files.filter((candidate) => candidate.startsWith(`${relative}/src/`))) {
      const subpath = SOURCE_FILE.exec(file.slice(relative.length + 1))?.[1];

      if (!subpath) continue;
      specifiers.add(`${name}/${subpath}`);

      for (let dir = path.posix.dirname(subpath); dir !== '.'; dir = path.posix.dirname(dir)) {
        specifiers.add(`${name}/${dir}/`);
      }
    }
  }

  return specifiers;
}

// Rule files write paths from the repo root, a workspace (`src/index.ts`) or its `src/`.
function listPathStarts(params) {
  const { files, workspaces } = params;
  const roots = ['', ...workspaces.flatMap(({ relative }) => [`${relative}/`, `${relative}/src/`])];

  return new Set(
    files.flatMap((file) => {
      return roots
        .filter((start) => file.startsWith(start))
        .map((start) => file.slice(start.length).split('/')[0]);
    }),
  );
}

function readCodeTokens(params) {
  const { root, files } = params;
  const words = new Set();
  const kebabWords = new Set();

  for (const file of files.filter(isEvidence)) {
    const text = readFileSync(path.join(root, file), 'utf8');

    if (text.includes('\0')) continue;
    for (const [word] of text.matchAll(/[A-Za-z_$][\w$]*/g)) words.add(word);
    for (const [word] of text.matchAll(/[a-z][\w-]*/g)) kebabWords.add(word);
  }

  return { words, kebabWords };
}

/** What the references are checked against; see `findReferenceProblem`. */
function buildRepoIndex(params) {
  const { root, files } = params;
  const workspaces = listWorkspaces(root);
  const extensions = new Set(files.map((file) => path.posix.extname(file)).filter(Boolean));

  return {
    files,
    dirs: listDirs(files),
    extensions,
    pathStarts: listPathStarts({ files, workspaces }),
    scripts: readScripts({ root, workspaces }),
    specifiers: listSpecifiers({ files, workspaces }),
    scope: readScope(root),
    ...readCodeTokens({ root, files }),
  };
}

function listRuleFiles(files) {
  return RULE_FILE_GLOBS.flatMap((glob) => {
    const matched = files.filter((file) => path.matchesGlob(file, glob));

    if (matched.length === 0) throw new Error(`No file matches ${glob}; nothing to check there.`);

    return matched;
  });
}

function readAllowlist(root) {
  const allowlist = readJson(path.join(root, ALLOWLIST_FILE));
  const isObject = allowlist && typeof allowlist === 'object' && !Array.isArray(allowlist);

  if (!isObject) throw new Error(`${ALLOWLIST_FILE} is not a { reference: reason } object.`);

  for (const [reference, reason] of Object.entries(allowlist)) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new Error(`${ALLOWLIST_FILE}: \`${reference}\` needs a reason.`);
    }
  }

  return new Map(Object.entries(allowlist));
}

/**
 * Every reference in the rule files to code that doesn't exist, then every allow-list entry no
 * rule file needs, given the repo's tracked and untracked `files` (relative to `root`).
 */
export function ruleReferenceProblems(params) {
  const { root } = params;
  // git still lists a file deleted from the working tree until the deletion is staged.
  const files = params.files.filter((file) => {
    return existsSync(path.join(root, file)) && statSync(path.join(root, file)).isFile();
  });
  const index = buildRepoIndex({ root, files });
  const allowlist = readAllowlist(root);
  const used = new Set();
  const problems = [];

  for (const file of listRuleFiles(files)) {
    const text = readFileSync(path.join(root, file), 'utf8');

    for (const { line, reference } of extractReferences(text)) {
      const { problem, allowed } = findReferenceProblem({ reference, index, allowlist });

      for (const entry of allowed) used.add(entry);
      if (problem) problems.push(`${file}:${line}: \`${reference}\`: ${problem}.`);
    }
  }

  const unused = [...allowlist.keys()].filter((reference) => !used.has(reference));

  return [
    ...problems,
    ...(problems.length > 0 ? [FIX] : []),
    ...unused.map((reference) => {
      return `${ALLOWLIST_FILE}: \`${reference}\` is no longer needed: every rule file that named it resolves now. Remove the entry.`;
    }),
  ];
}
