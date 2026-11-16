// What the stop hook's gate holds this chat to: the files it edited, the workspaces they are in,
// and the workspaces depending on those (a change can break an importer). Several chats can share
// the checkout, so the gate never reports another chat's unfinished work back to this one: a
// dependent workspace holding another chat's uncommitted edits is that chat's to check, and from
// the repo-wide checks only the problems naming this chat's files or workspaces are kept. CI runs
// the whole gate on every PR, so nothing left out here goes unchecked.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import {
  listWorkspaces,
  readLayout,
  workspaceOfRelative,
} from '../../packages/eslint-config/src/layout.utils.js';
import { GENERATED_DOCS } from '../../scripts/graph.mjs';

/** The workspaces `names` reach as importers, transitively, themselves included. */
function withDependents(params) {
  const { names, layout } = params;
  const found = new Set(names);

  for (let grew = true; grew;) {
    grew = false;

    for (const [name, entry] of Object.entries(layout)) {
      const imports = [...entry.dependsOn, ...entry.devDependsOn];

      if (!found.has(name) && imports.some((dependency) => found.has(dependency))) {
        found.add(name);
        grew = true;
      }
    }
  }

  return found;
}

/**
 * This chat's scope in the checkout at `root`: `files` (project-relative, what it edited), the
 * workspaces to check (`names`), whether the root's own files are in it (`root`), and the
 * workspace dirs and names a problem line can name. `dirty` is every file `git status` lists,
 * `othersEdited` every file another chat recorded editing.
 */
export function gateScope(params) {
  const { root, files, dirty, othersEdited } = params;
  const workspaces = listWorkspaces(root);
  const owned = (file) => workspaceOfRelative({ workspaces, file });
  const edited = new Set(
    files
      .map(owned)
      .filter(Boolean)
      .map(({ name }) => name),
  );
  const othersWip = new Set(
    [...othersEdited]
      .filter((file) => dirty.has(file))
      .map((file) => owned(file)?.name)
      .filter(Boolean),
  );
  const dependents = withDependents({ names: edited, layout: readLayout({ root }) });
  const names = [...dependents].filter((name) => edited.has(name) || !othersWip.has(name)).sort();
  // A workspace's package.json is what the generated docs are drawn from.
  const drawsDocs = files.some((file) => owned(file) && file.endsWith('/package.json'));

  return {
    files: new Set([...files, ...(drawsDocs ? GENERATED_DOCS : [])]),
    names,
    root: files.some((file) => !owned(file)),
    dirs: workspaces.filter(({ name }) => names.includes(name)).map(({ relative }) => relative),
    // Every workspace, so a problem in one outside the scope is known to be another chat's.
    everyWorkspace: workspaces.flatMap(({ name, relative }) => [name, relative]),
  };
}

/** turbo's `--filter`s for the scope: each workspace in it, and the root's tasks if it is in. */
export function turboFilters(scope) {
  return [...scope.names, ...(scope.root ? ['//'] : [])].map((name) => `--filter=${name}`);
}

/** Of `files` (or undefined when git couldn't list them), the ones in the scope; all, unscoped. */
export function scopedFiles(params) {
  const { files, scope } = params;

  return scope ? files?.filter((file) => scope.files.has(file)) : files;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `line` names one of the scope's files, or a workspace in it by name or folder. */
function namesScope(params) {
  const { line, scope, root } = params;

  return mentionsAny({
    text: line.replaceAll(`${root}${path.sep}`, ''),
    mentions: [...scope.files, ...scope.dirs, ...scope.names],
  });
}

function mentionsAny(params) {
  const { text, mentions } = params;

  return mentions.some((mention) => new RegExp(`${escape(mention)}(?![\\w-])`).test(text));
}

/** A path-like word: `docs/overview.md`, `src/a.ts:3:5`, `/repo/scripts/x.mjs`. */
const PATH_WORD = /[\w./-]*\/[\w.-]+|[\w-]+\.[a-z]{2,4}\b/g;

/**
 * Whether `line` is a problem someone in this checkout owns: it names a workspace, or a file that
 * exists in the repo. Anything else (a stack trace, npm's log path, a tool's own error) is not.
 */
function isAttributable(params) {
  const { line, scope, root } = params;
  const text = line.replaceAll(`${root}${path.sep}`, '');

  if (mentionsAny({ text, mentions: scope.everyWorkspace })) return true;

  return [...text.matchAll(PATH_WORD)].some(([word]) => {
    const file = word.replace(/:\d+(:\d+)?$/, '');

    return !path.isAbsolute(file) && existsSync(path.join(root, file));
  });
}

/** A knip section title (`Unused files (3)`): kept only above a line the scope keeps. */
const SECTION_TITLE = /^\S.*\(\d+\)\s*$/;

/**
 * A repo-wide check's report cut to the lines about this chat's scope, with the section titles
 * above them; null when none is. Unless every problem in it is one someone in this checkout owns,
 * it is kept whole: a check that couldn't run (a crash, a missing script) is never read as passing.
 */
export function scopedReport(params) {
  const { output, scope, root } = params;
  const lines = output.split('\n');
  const isFinding = (line) => line.trim() !== '' && !SECTION_TITLE.test(line);
  const kept = lines.filter((line, index) => {
    if (!SECTION_TITLE.test(line)) return isFinding(line) && namesScope({ line, scope, root });

    const section = lines.slice(index + 1);
    const end = section.findIndex((next) => SECTION_TITLE.test(next));

    return (end === -1 ? section : section.slice(0, end)).some((next) => {
      return namesScope({ line: next, scope, root });
    });
  });

  if (kept.length > 0) return kept.join('\n');

  const findings = lines.filter(isFinding);
  const allOwned =
    findings.length > 0 && findings.every((line) => isAttributable({ line, scope, root }));

  if (allOwned) return null;

  return output.trim() || 'It failed without printing why; run it yourself to see.';
}

/** The workspace a turbo report line comes from: `@sheavly/core` (`@sheavly/core:lint: …`), `//`. */
const TURBO_TASK = /^(@[\w-]+\/[\w-]+|\/\/):\S+: /;

/** The first line of a clone in jscpd's report; the lines indented under it name its files. */
const CLONE_HEADER = /^Clone found/;

/** The clones in jscpd's report (colors removed), each as its header and the lines under it. */
function cloneBlocks(lines) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (CLONE_HEADER.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.push(line);
    } else {
      current = null;
    }
  }

  return blocks;
}

/**
 * jscpd's report cut to the clones with a file in this chat's scope; null when it has clones and
 * none is. Its summary table, totals and threshold line name no file, so `scopedReport` alone
 * would hand every chat any clone in the checkout. A report with no clone in it (a crash, a
 * config problem) is cut the way `scopedReport` cuts it: kept whole.
 */
export function scopedCloneReport(params) {
  const { output, scope, root } = params;
  const lines = stripVTControlCharacters(output).split('\n');
  const blocks = cloneBlocks(lines);

  if (blocks.length === 0) return scopedReport(params);
  const kept = blocks.filter((block) => block.some((line) => namesScope({ line, scope, root })));

  return kept.length > 0 ? kept.map((block) => block.join('\n')).join('\n') : null;
}

/**
 * turbo's cut-down report (`formatTurboReport`) kept to the scope's workspaces: a task a scope
 * workspace depends on runs first and may fail on another chat's work. Null when nothing is left.
 */
export function scopedTurboReport(params) {
  const { report, scope } = params;
  const inScope = (workspace) =>
    scope.names.includes(workspace) || (scope.root && workspace === '//');
  const lines = report.split('\n');
  const kept = lines.filter((line) => {
    const workspace = TURBO_TASK.exec(line)?.[1];

    if (workspace) return inScope(workspace);
    if (!line.startsWith('Failed:')) return true;

    return line.split(/[\s,]+/).some((task) => inScope(task.split('#')[0]));
  });
  const hasTask = kept.some((line) => TURBO_TASK.test(line));

  if (hasTask) return kept.join('\n');

  return lines.some((line) => TURBO_TASK.test(line)) ? null : report;
}
