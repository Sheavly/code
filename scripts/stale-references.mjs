// References that rot once the code moves on. Derived from the code, not a list of old paths:
// - the layout before the split into workspaces: the root `src/` is gone, and every folder it had
//   is a workspace now. A path that starts at `src/<name>`, where `<name>` is a workspace's folder,
//   is stale unless it exists inside the file's own workspace (an app's own `src/workbook/`).
//   Folders every workspace may have (`testing/`, `errors/`) are conventions, not old layout.
//   Tests are skipped here: their paths name files in their own temp repos;
// - an issue named in a workspace's source: code says what it does, and its history and plans
//   live in the issue and the commits. Elsewhere (the docs cite open issues on purpose) only a
//   promise about one ("until" or "once" an issue number, or code that "moves into" a package
//   with one) fails: say what is true now, and keep what is still to do in the issue;
// - skills outside `.agents/skills/`: Cursor would load one in `.cursor/skills/` too, but the
//   skill checks (`.cursor/hooks/skills.utils.mjs`) read only `.agents/skills/`, so a skill there,
//   or a path naming that folder, fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { listWorkspaces, workspaceOfFile } from '../packages/eslint-config/src/layout.utils.js';

const TEXT = /\.(md|[cm]?[jt]s|json)$/;
/** Generated, or the workbook's runs and fixture projects: not ours to word. */
const SKIPPED =
  /^(package-lock\.json|workbook\/(runs|workspaces)\/)|^scripts\/(__tests__\/)?stale-references\./;
const TEST_CODE = /(^|\/)__tests__\//;
const WORKSPACE_SOURCE = /^(packages|apps)\/[^/]+\/src\//;
const ISSUE = /(?<![\w&])#\d+\b/;
const OLD_PATH = /(?<![\w./@-])src\/([a-z][\w-]*)(\/[\w./-]*|\.ts)?/g;
const PROMISE = /\b(until|once|after|when|as) #\d+\b|\bmoves? (with|into) [^.\n]*\(#\d+\)/i;
const OLD_SKILLS = '.cursor/skills';
const SKILLS_MOVED = `skills live in .agents/skills/ (the skill checks read only that folder)`;

/**
 * The workspace folder names (`loop`, `terminal`): what the root `src/` held before. A name
 * that is also a folder in two or more workspaces' `src/` (`testing`) is a convention instead.
 */
function workspaceFolders(params) {
  const { root, workspaces } = params;
  const inSources = workspaces.flatMap(({ dir }) =>
    existsSync(path.join(dir, 'src'))
      ? readdirSync(path.join(dir, 'src'), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [],
  );
  const conventional = new Set(
    inSources.filter((name, index) => inSources.indexOf(name) !== index),
  );

  return new Set(
    listWorkspaces(root)
      .map(({ relative }) => path.posix.basename(relative))
      .filter((name) => !conventional.has(name)),
  );
}

function stalePaths(params) {
  const { root, file, text, folders, workspaces } = params;
  const owner = workspaceOfFile({ workspaces, file: path.join(root, file) });

  return [...text.matchAll(OLD_PATH)].flatMap((match) => {
    const [found, folder] = match;

    if (!folders.has(folder)) return [];
    if (owner && existsSync(path.join(owner.dir, `src/${folder}`))) return [];

    return [
      `${file}: \`${found}\` is the layout before the split (there is no root src/ any more). Name the workspace: packages/${folder}/src/… or apps/${folder}/src/…`,
    ];
  });
}

/** Every stale reference in `files` (relative to `root`): old root `src/` paths and issue promises. */
export function staleReferenceProblems(params) {
  const { root, files } = params;
  const workspaces = listWorkspaces(root);
  const folders = workspaceFolders({ root, workspaces });

  const misplaced = files
    .filter((file) => file.startsWith(`${OLD_SKILLS}/`))
    .map((file) => `${file}: ${SKILLS_MOVED}. Move it there.`);

  return [
    ...misplaced,
    ...files
      .filter((file) => TEXT.test(file) && !SKIPPED.test(file) && existsSync(path.join(root, file)))
      .flatMap((file) => {
        const text = readFileSync(path.join(root, file), 'utf8');
        const inSource = WORKSPACE_SOURCE.test(file) && !TEST_CODE.test(file);
        const promise = text
          .split('\n')
          .findIndex((line) => (inSource ? ISSUE : PROMISE).test(line));

        return [
          ...new Set(
            TEST_CODE.test(file) ? [] : stalePaths({ root, file, text, folders, workspaces }),
          ),
          ...(text.includes(OLD_SKILLS)
            ? [`${file}: names ${OLD_SKILLS}/, but ${SKILLS_MOVED}.`]
            : []),
          ...(promise === -1
            ? []
            : [
                `${file}:${promise + 1}: ${inSource ? 'names an issue in code' : 'promises what an issue will do'} ("${text.split('\n')[promise].trim().slice(0, 80)}"). Say what is true now; history and plans live in the issue.`,
              ]),
        ];
      }),
  ];
}
