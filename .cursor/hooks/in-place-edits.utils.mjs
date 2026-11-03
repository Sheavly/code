// An in-place shell editor (`sed -i`, `perl -pi`, a scripted `vim -c … wq`) changes a project
// file without the edit tools, so the post-edit hook never formats or lints it, the stop hook
// never checks the chat, and the editor shows no diff for it. Agents edit with StrReplace/Write.
//
// Best-effort like the git guard: it reads the editor's file operands and fails closed (denies)
// when it finds none it can place outside the project. Read-only uses (`sed -n`, a
// `sed 's/a/b/' file` to stdout, `perl -ne`) edit nothing and stay allowed.
import path from 'node:path';
import {
  isOutsideProject,
  normalize,
  programName,
  startsWithNonExecuting,
  toSegments,
  withoutHeredocBodies,
} from './shell-parse.utils.mjs';

export const IN_PLACE_FIX =
  'Edit files with the edit tools (StrReplace/Write), not an in-place shell editor: only their edits are formatted, linted and checked by the hooks, and shown as a diff.';

/**
 * How each editor reads its arguments. `valueFlags`: short flags that take a value (inline or as
 * the next word); `scriptFlags`: those whose value is the program, so no positional is;
 * `suffixFlags`: short flags whose rest of the cluster is a backup suffix (`-i.bak`).
 */
const STREAM_EDITORS = {
  sed: {
    valueFlags: 'efl',
    scriptFlags: 'ef',
    suffixFlags: 'i',
    longValues: ['--expression', '--file', '--line-length'],
    longScripts: ['--expression', '--file'],
  },
  // Only flags that take the rest of the cluster stop the scan: `-lpi` is `-l -p -i`.
  perl: {
    valueFlags: 'eEIMm',
    scriptFlags: 'eE',
    suffixFlags: 'i',
    longValues: [],
    longScripts: [],
  },
  ruby: {
    valueFlags: 'eIrCEF',
    scriptFlags: 'e',
    suffixFlags: 'i',
    longValues: [],
    longScripts: [],
  },
  awk: {
    valueFlags: 'fvieElW',
    scriptFlags: 'feE',
    suffixFlags: '',
    longValues: ['--include', '--file', '--source', '--assign'],
    longScripts: ['--file', '--source'],
  },
};

STREAM_EDITORS.gawk = STREAM_EDITORS.awk;

// Line and screen editors: any file they are given is opened for editing, so every positional
// is a file, and `+cmd` words are commands. vim only edits unattended when scripted (`-c`,
// `+cmd`, `-s`, `-e`/`-es`, `--cmd`); its `-s` is "silent" in ex mode, so it takes no value here.
const SCREEN_EDITOR = {
  valueFlags: 'cSuiTtwW',
  scriptFlags: '',
  suffixFlags: '',
  longValues: ['--cmd'],
  longScripts: [],
  plusCommands: true,
};
const LINE_EDITORS = new Set(['ex', 'ed']);
const SCRIPTABLE_EDITORS = new Set(['vim', 'vi', 'nvim']);
const SCRIPTED_VIM = /^(?:-[a-zA-Z]*[cseES]|--cmd(?:=|$)|\+)/;
// Programs that run the words after them as a command, and the `find` flags that do.
const LAUNCHERS = new Set([
  'xargs',
  'sudo',
  'doas',
  'env',
  'timeout',
  'nice',
  'nohup',
  'stdbuf',
  'setsid',
  'exec',
  'command',
  'time',
  'eval',
  'systemd-run',
]);
const EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/** Whether a single-dash cluster (`-ni`, `-pi`) sets `flag` before a flag that takes the rest. */
function clusterHas(params) {
  const { token, flag, valueFlags } = params;

  if (!/^-[^-]/.test(token)) return false;

  for (const char of token.slice(1)) {
    if (char === flag) return true;
    if (valueFlags.includes(char)) return false;
  }

  return false;
}

// gawk loads its in-place extension with `-i inplace`, `-iinplace` or `--include=inplace`.
function includesInplace(tokens) {
  return tokens.some((token, index) => {
    const match = /^(?:-i|--include=?)(.*)$/.exec(token);

    return Boolean(match) && /^inplace\b/.test(match[1] || (tokens[index + 1] ?? ''));
  });
}

function isInPlace(params) {
  const { name, args } = params;

  if (name === 'awk' || name === 'gawk') return includesInplace(args);
  const { valueFlags } = STREAM_EDITORS[name];

  return args.some(
    (token) =>
      (name === 'sed' && /^--in-place(?:=|$)/.test(token)) ||
      clusterHas({ token, flag: 'i', valueFlags }),
  );
}

/** How many following words a flag consumes, and whether it carried the program. */
function readFlag(params) {
  const { token, grammar } = params;
  const [longName] = token.split('=');

  if (token.startsWith('--')) {
    const takesNext = grammar.longValues.includes(longName) && !token.includes('=');

    return { skip: takesNext ? 1 : 0, isScript: grammar.longScripts.includes(longName) };
  }

  const chars = token.slice(1);
  const index = [...chars].findIndex(
    (char) => grammar.valueFlags.includes(char) || grammar.suffixFlags.includes(char),
  );

  if (index === -1 || grammar.suffixFlags.includes(chars[index])) {
    return { skip: 0, isScript: false };
  }

  return {
    skip: index === chars.length - 1 ? 1 : 0,
    isScript: grammar.scriptFlags.includes(chars[index]),
  };
}

/** The words an editor treats as files: positionals, minus the program when no flag gave it. */
function readFileOperands(params) {
  const { args, grammar, hasPositionalScript } = params;
  const positionals = [];
  let scriptFromFlag = false;

  for (let index = 0; index < args.length; index++) {
    const token = args[index];

    if (!token.startsWith('-') || token === '-') {
      if (!(grammar.plusCommands && token.startsWith('+'))) positionals.push(token);
      continue;
    }

    const flag = readFlag({ token, grammar });

    scriptFromFlag ||= flag.isScript;
    index += flag.skip;
  }

  return hasPositionalScript && !scriptFromFlag ? positionals.slice(1) : positionals;
}

/** The grammar of the in-place editor a segment runs from `index`, or null when it edits nothing. */
function readEditor(params) {
  const { tokens, index } = params;
  const name = programName(tokens[index]);
  const args = tokens.slice(index + 1);
  const stream = STREAM_EDITORS[name];

  if (stream) {
    return isInPlace({ name, args }) ? { grammar: stream, hasPositionalScript: true } : null;
  }

  if (LINE_EDITORS.has(name)) return { grammar: SCREEN_EDITOR, hasPositionalScript: false };

  if (SCRIPTABLE_EDITORS.has(name) && args.some((arg) => SCRIPTED_VIM.test(arg))) {
    return { grammar: SCREEN_EDITOR, hasPositionalScript: false };
  }

  return null;
}

/**
 * Whether a segment's word at `index` runs as a program: the first word, any word after a
 * launcher (`xargs`, `sudo -u root`, `timeout 5`), or the word after `find -exec`. Other words
 * are data, such as quoted prose that names an editor once quotes are gone.
 */
function runsAt(params) {
  const { tokens, index } = params;

  if (index === 0) return true;
  const previous = tokens[index - 1];
  const isShellScript = SHELLS.has(programName(tokens[0])) && /^-\w*c$/.test(previous);

  return LAUNCHERS.has(programName(tokens[0])) || EXEC_FLAGS.has(previous) || isShellScript;
}

/**
 * Whether one segment edits a project file in place. A segment that only prints or searches
 * (`rg 'sed -i'`) runs none of its words.
 */
function editsInPlace(params) {
  const { tokens, cwd, projectRoot } = params;

  if (startsWithNonExecuting(tokens)) return false;

  return tokens.some((_, index) => {
    const editor = runsAt({ tokens, index }) ? readEditor({ tokens, index }) : null;

    if (!editor) return false;
    const operands = readFileOperands({ args: tokens.slice(index + 1), ...editor });

    return (
      operands.length === 0 ||
      operands.some((operand) => !isOutsideProject({ file: operand, cwd, projectRoot }))
    );
  });
}

/** Whether `command`, run from `cwd`, edits a file under `projectRoot` with an in-place editor. */
export function findInPlaceEdit(params) {
  const { command, projectRoot } = params;
  let { cwd } = params;

  for (const tokens of toSegments(normalize(withoutHeredocBodies(command)))) {
    if (tokens[0] === 'cd' && tokens[1]) cwd = path.resolve(cwd, tokens[1]);
    if (editsInPlace({ tokens, cwd, projectRoot })) return true;
  }

  return false;
}
